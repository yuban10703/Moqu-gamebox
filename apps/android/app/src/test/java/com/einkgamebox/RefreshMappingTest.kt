package com.einkgamebox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 纯逻辑单元测试：刷新档位与设备实际模式名之间的映射。
 * 这是壳层里唯一不需要真机就能验证的部分；真机行为见 docs/A01-device-baseline.md 的记录流程。
 */
class RefreshMappingTest {

    @Test
    fun `quality prefers regal then gu`() {
        assertEquals(listOf("REGAL", "GU", "DU_QUALITY"), RefreshMapping.partialCandidates("quality"))
    }

    @Test
    fun `speed prefers du`() {
        assertEquals(listOf("DU", "ANIMATION", "GU"), RefreshMapping.partialCandidates("speed"))
    }

    @Test
    fun `unknown profile falls back to quality order`() {
        assertEquals(listOf("REGAL", "GU"), RefreshMapping.partialCandidates("whatever"))
    }

    @Test
    fun `pick returns first candidate actually provided by device`() {
        val available = listOf("GU", "GC", "ANIMATION")
        assertEquals("GU", RefreshMapping.pick(listOf("REGAL", "GU"), available))
        assertNull(RefreshMapping.pick(listOf("NOPE", "ALSO_NOPE"), available))
    }

    @Test
    fun `actualName keeps the device spelling and ignores case`() {
        val available = listOf("gc", "Regal", "DU")
        assertEquals("gc", RefreshMapping.actualName(RefreshMapping.fullRefreshCandidates(), available))
        assertEquals("Regal", RefreshMapping.actualName(RefreshMapping.partialCandidates("quality"), available))
        assertEquals("DU", RefreshMapping.actualName(RefreshMapping.fastCandidates(), available))
    }

    @Test
    fun `full refresh never falls back to a black and white fast mode first`() {
        // 全刷优先 16 级灰阶全屏，避免用快刷模式清残影反而加重残影
        assertEquals(listOf("GC", "GC16", "GU", "DU"), RefreshMapping.fullRefreshCandidates())
    }
}
