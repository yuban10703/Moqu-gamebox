package com.einkgamebox

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

class BackupReaderTest {
    @Test fun acceptsExactByteLimitAndUtf8() {
        val bytes = "墨趣".toByteArray(Charsets.UTF_8)
        assertEquals("墨趣", BackupReader.readText(ByteArrayInputStream(bytes), bytes.size))
        assertEquals("", BackupReader.readText(ByteArrayInputStream(byteArrayOf()), 0))
    }

    @Test fun stopsAnUnboundedProviderAfterLimitPlusOneByte() {
        var read = 0
        val stream = object : InputStream() {
            override fun read(): Int { read++; return 65 }
        }
        try {
            BackupReader.readText(stream, 16)
            fail("oversized backup should fail")
        } catch (error: IOException) {
            assertEquals("backup-too-large", error.message)
        }
        assertEquals(17, read)
    }
}
