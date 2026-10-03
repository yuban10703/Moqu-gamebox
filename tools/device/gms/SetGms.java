/*
 * 在设备本地直接调用 ONYX 框架 API，读写系统 MMKV 里的 gms_enable 开关。
 *
 * 为什么需要它：ONYX 固件在 framework 里加了一道闸门 ——
 *   ActivityStarter.executeRequest() 会对 com.android.vending 这类包抛
 *   SecurityException("This app is not allowed to start because Google Play is disabled.")，
 * 判据是 android.onyx.utils.ActivityManagerHelper.gmsEnabled()，
 * 而它读的是 OnyxMMKVConfigHelper.getBool("gms_enable")（落在 /onyxconfig/mmkv/onyx_config）。
 * 官方只在「设置」应用联网问 BOOX 服务器（checkGooglePlay）之后才会把这个键写成 true，
 * 国行机器拿不到 true，于是 Play 商店永远起不来。这里直接把该键写成 true。
 *
 * 用法（由 tools/device/enable-gms-play.sh 打包并调用）：
 *   CLASSPATH=/data/local/tmp/gms.dex app_process /system/bin SetGms [status|on|off]
 *
 * 只用 java.lang.reflect，不依赖任何编译期 ONYX 类，避免 SDK 版本差异。
 */

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

public class SetGms {

    private static final String KEY = "gms_enable";

    private static Object call(Class<?> cls, String name, Class<?>[] types, Object... args) throws Exception {
        Method m = cls.getDeclaredMethod(name, types);
        m.setAccessible(true);
        Object recv = null;
        if (!Modifier.isStatic(m.getModifiers())) {
            // ONYX 的这些 helper 都是单例风格，先试 sharedInstance()，再退回无参构造。
            try {
                Method si = cls.getDeclaredMethod("sharedInstance");
                si.setAccessible(true);
                recv = si.invoke(null);
            } catch (NoSuchMethodException e) {
                recv = cls.getDeclaredConstructor().newInstance();
            }
        }
        try {
            return m.invoke(recv, args);
        } catch (InvocationTargetException e) {
            throw new RuntimeException(name + " 调用失败", e.getCause());
        }
    }

    public static void main(String[] args) throws Exception {
        String cmd = args.length > 0 ? args[0] : "status";
        if (!cmd.equals("status") && !cmd.equals("on") && !cmd.equals("off")) {
            System.err.println("用法: SetGms [status|on|off]");
            System.exit(2);
        }

        Class<?> helper = Class.forName("android.onyx.optimization.OnyxMMKVConfigHelper");
        Class<?> amh = Class.forName("android.onyx.utils.ActivityManagerHelper");
        Class<?>[] boolKey = new Class<?>[] { String.class, boolean.class };

        System.out.println("gms_enable(读前) = " + call(helper, "getBool", boolKey, KEY, false));

        if (!cmd.equals("status")) {
            boolean want = cmd.equals("on");
            call(helper, "saveValue", boolKey, KEY, want);
            System.out.println("已写入 gms_enable = " + want);
        }

        System.out.println("gms_enable(读回) = " + call(helper, "getBool", boolKey, KEY, false));
        System.out.println("ActivityManagerHelper.gmsEnabled() = " + call(amh, "gmsEnabled", new Class<?>[] {}));
    }
}
