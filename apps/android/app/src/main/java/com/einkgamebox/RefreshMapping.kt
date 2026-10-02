package com.einkgamebox

/**
 * 刷新档位 ↔ 屏幕模式名的映射（纯逻辑，可做 JVM 单元测试）。
 *
 * 关键原则：**不硬编码型号**。这里只给出「按优先级尝试的候选名」，
 * 真正可用的名字来自运行时对 SDK 的探测结果（见 OnyxEinkBackend）。
 * BOOX 不同固件暴露的模式名并不一致，硬编码会在某些机型上直接失败。
 */
object RefreshMapping {

    /** 局部更新模式候选（清晰优先 → 速度优先） */
    fun partialCandidates(profile: String): List<String> = when (profile) {
        "quality" -> listOf("REGAL", "GU", "DU_QUALITY")
        "balanced" -> listOf("GU", "REGAL", "DU_QUALITY")
        "speed" -> listOf("DU", "ANIMATION", "GU")
        else -> listOf("REGAL", "GU")
    }

    /** 整屏全刷候选：优先 16 级灰阶全屏，其次黑白全屏 */
    fun fullRefreshCandidates(): List<String> = listOf("GC", "GC16", "GU", "DU")

    /** 临时快刷候选（用于点击后的即时反馈） */
    fun fastCandidates(): List<String> = listOf("ANIMATION", "DU", "A2", "FAST")

    /** 从候选里挑出设备实际提供的第一个模式名；都没有则返回 null */
    fun pick(candidates: List<String>, available: Collection<String>): String? =
        candidates.firstOrNull { name -> available.any { it.equals(name, ignoreCase = true) } }

    /** 与候选同名（忽略大小写）的实际模式名 */
    fun actualName(candidates: List<String>, available: Collection<String>): String? {
        for (candidate in candidates) {
            available.firstOrNull { it.equals(candidate, ignoreCase = true) }?.let { return it }
        }
        return null
    }
}
