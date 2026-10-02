package com.einkgamebox

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * 原生事务存储：一个 key-value 表，由 SQLite 事务保证原子性。
 *
 * 为什么用原生存储而不是 WebView 里的 localStorage/IndexedDB：
 * - 卸载/清理数据的边界更清晰，写入失败能明确回报；
 * - `cas`（读-比对-写）与 `putMany` 在**同一个事务**里完成，
 *   这样提交协议（pending → committed → 删除 pending）才真正具备原子性。
 * JS 侧仍然复用 @eink/core 里同一套提交协议，两端行为一致。
 */
class NativeStore(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // schema 1：目前无需迁移；后续新增表结构时在这里按版本逐级升级
    }

    fun get(key: String): String? =
        readableDatabase.rawQuery("SELECT v FROM kv WHERE k = ?", arrayOf(key)).use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    fun put(key: String, value: String) {
        writableDatabase.execSQL(
            "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
            arrayOf<Any>(key, value),
        )
    }

    fun delete(key: String) {
        writableDatabase.execSQL("DELETE FROM kv WHERE k = ?", arrayOf<Any>(key))
    }

    fun deletePrefix(prefix: String) {
        writableDatabase.execSQL("DELETE FROM kv WHERE k LIKE ? || '%'", arrayOf<Any>(prefix))
    }

    fun keys(prefix: String): List<String> =
        writableDatabase.rawQuery(
            "SELECT k FROM kv WHERE k LIKE ? || '%' ORDER BY k",
            arrayOf(prefix),
        ).use { cursor ->
            val result = ArrayList<String>(cursor.count)
            while (cursor.moveToNext()) result.add(cursor.getString(0))
            result
        }

    /** 原子「读-比对-写」 */
    fun cas(key: String, expected: String?, value: String): Pair<Boolean, String?> {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val current = db.rawQuery("SELECT v FROM kv WHERE k = ?", arrayOf(key)).use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
            if (current != expected) return false to current
            db.execSQL(
                "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
                arrayOf<Any>(key, value),
            )
            db.setTransactionSuccessful()
            return true to value
        } finally {
            db.endTransaction()
        }
    }

    /** 原子批量写 */
    fun putMany(entries: List<Pair<String, String>>) {
        if (entries.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for ((key, value) in entries) {
                val values = ContentValues().apply {
                    put("k", key)
                    put("v", value)
                }
                db.insertWithOnConflict("kv", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    companion object {
        private const val DB_NAME = "eink-gamebox.db"
        private const val DB_VERSION = 1
    }
}
