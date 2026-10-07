package com.einkgamebox

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/** Same byte limit as @eink/core; never trust a document provider's reported file size. */
object BackupReader {
    const val MAX_BACKUP_BYTES = 16 * 1024 * 1024

    fun readText(stream: InputStream, maxBytes: Int = MAX_BACKUP_BYTES): String {
        require(maxBytes >= 0)
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            // Read at most one byte beyond the limit, even for providers with no known length.
            val count = stream.read(buffer, 0, minOf(buffer.size, maxBytes - total + 1))
            if (count < 0) break
            if (count == 0) {
                val single = stream.read()
                if (single < 0) break
                if (total == maxBytes) throw IOException("backup-too-large")
                output.write(single)
                total++
                continue
            }
            total += count
            if (total > maxBytes) throw IOException("backup-too-large")
            output.write(buffer, 0, count)
        }
        return output.toString(Charsets.UTF_8.name())
    }
}
