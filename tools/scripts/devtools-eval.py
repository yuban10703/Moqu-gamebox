#!/usr/bin/env python3
"""最小的 Chrome DevTools Protocol 求值工具（只为真机排障用）。

用法：
    python3 tools/scripts/devtools-eval.py <ws-url> "<javascript>"

为什么自己写：真机排障需要在页面里求值，但环境里没有 websocket 客户端库，
而装一个库只为调试不划算。这里只实现握手 + 文本帧，约 60 行。
"""
import base64
import json
import os
import socket
import struct
import sys
import urllib.parse


def connect(url: str, timeout: float = 15.0) -> socket.socket:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or '127.0.0.1'
    port = parsed.port or 80
    path = parsed.path or '/'
    sock = socket.create_connection((host, port), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f'GET {path} HTTP/1.1\r\n'
        f'Host: {host}:{port}\r\n'
        'Upgrade: websocket\r\n'
        'Connection: Upgrade\r\n'
        f'Sec-WebSocket-Key: {key}\r\n'
        'Sec-WebSocket-Version: 13\r\n\r\n'
    )
    sock.sendall(handshake.encode())
    header = b''
    while b'\r\n\r\n' not in header:
        chunk = sock.recv(1)
        if not chunk:
            raise RuntimeError('handshake closed')
        header += chunk
    if b'101' not in header.split(b'\r\n')[0]:
        raise RuntimeError(f'handshake failed: {header[:120]!r}')
    return sock


def send_text(sock: socket.socket, payload: str) -> None:
    data = payload.encode()
    mask = os.urandom(4)
    header = bytearray([0x81])
    length = len(data)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header += struct.pack('>H', length)
    else:
        header.append(0x80 | 127)
        header += struct.pack('>Q', length)
    header += mask
    masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
    sock.sendall(bytes(header) + masked)


def recv_exact(sock: socket.socket, count: int) -> bytes:
    buf = b''
    while len(buf) < count:
        chunk = sock.recv(count - len(buf))
        if not chunk:
            raise RuntimeError('connection closed while reading frame')
        buf += chunk
    return buf


def recv_text(sock: socket.socket) -> str:
    while True:
        first, second = recv_exact(sock, 2)
        opcode = first & 0x0F
        masked = second & 0x80
        length = second & 0x7F
        if length == 126:
            length = struct.unpack('>H', recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack('>Q', recv_exact(sock, 8))[0]
        mask = recv_exact(sock, 4) if masked else None
        payload = recv_exact(sock, length)
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        if opcode == 0x1:
            return payload.decode('utf-8', 'replace')
        if opcode == 0x8:
            raise RuntimeError('server closed the websocket')
        # ping/pong/其它帧直接跳过


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    url, expression = sys.argv[1], sys.argv[2]
    sock = connect(url)
    try:
        send_text(
            sock,
            json.dumps(
                {
                    'id': 1,
                    'method': 'Runtime.evaluate',
                    'params': {
                        'expression': expression,
                        'returnByValue': True,
                        'awaitPromise': True,
                    },
                }
            ),
        )
        while True:
            message = json.loads(recv_text(sock))
            if message.get('id') == 1:
                result = message.get('result', {})
                if 'exceptionDetails' in result:
                    print('EXCEPTION:', json.dumps(result['exceptionDetails'], ensure_ascii=False)[:800])
                    return 1
                value = result.get('result', {}).get('value')
                print(json.dumps(value, ensure_ascii=False, indent=2) if not isinstance(value, str) else value)
                return 0
    finally:
        sock.close()


if __name__ == '__main__':
    raise SystemExit(main())
