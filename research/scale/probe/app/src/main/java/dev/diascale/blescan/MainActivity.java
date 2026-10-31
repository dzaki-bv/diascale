package dev.diascale.blescan;

import android.app.Activity;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import java.util.ArrayDeque;
import java.util.UUID;

/**
 * GATT probe: scans for MY_SCALE, connects, dumps services, reads 180A,
 * enables every notify/indicate characteristic and logs all bytes (tag BLEGATT).
 * Default: sends nothing but CCCD enables and reads. With extra "handshake"=true it
 * answers like FitDays+: B0 ack for AA/A5/A7, then C0 (time+profile) and C1 (user list)
 * with a DiaScale user id.
 */
public final class MainActivity extends Activity {
    private static final String TAG = "BLEGATT";
    private static final String TARGET = "60:65:F4:CD:EB:A2";
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private TextView text;
    private boolean connecting;
    private final ArrayDeque<Runnable> ops = new ArrayDeque<>();
    private boolean busy;
    private boolean handshake;
    private int pkt;
    private static final int UID = 0x0DA5CA1E;
    private static final UUID FFB1 = UUID.fromString("0000ffb1-0000-1000-8000-00805f9b34fb");

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) {
            if (connecting || !TARGET.equals(r.getDevice().getAddress())) return;
            connecting = true;
            ScanRecord rec = r.getScanRecord();
            log("found rssi=" + r.getRssi() + " adv=" + hex(rec == null ? null : rec.getBytes()));
            scanner.stopScan(this);
            gatt = r.getDevice().connectGatt(MainActivity.this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
            log("state=" + state + " status=" + status);
            if (state == BluetoothProfile.STATE_CONNECTED) {
                g.requestMtu(247);
            } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                g.close();
                synchronized (ops) { ops.clear(); busy = false; }
                connecting = false;
                startScan();
            }
        }

        @Override public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            log("mtu=" + mtu + " status=" + status);
            g.discoverServices();
        }

        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            log("services status=" + status);
            for (BluetoothGattService s : g.getServices()) {
                log("svc " + s.getUuid());
                for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                    int p = c.getProperties();
                    log("  chr " + c.getUuid() + " props=0x" + Integer.toHexString(p));
                    if (s.getUuid().toString().startsWith("0000180a") && (p & BluetoothGattCharacteristic.PROPERTY_READ) != 0)
                        enqueue(() -> g.readCharacteristic(c));
                }
            }
            // Same order as FitDays+: FFB3 first, then FFB2, then anything else that notifies.
            enableNotify(g, "0000ffb3");
            enableNotify(g, "0000ffb2");
            for (BluetoothGattService s : g.getServices())
                for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                    String u = c.getUuid().toString();
                    if (u.startsWith("0000ffb3") || u.startsWith("0000ffb2")) continue;
                    if ((c.getProperties() & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0)
                        subscribe(g, c);
                }
            runOnUiThread(() -> text.setText("Connected, listening…"));
        }

        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] v, int status) {
            log("read " + c.getUuid() + " status=" + status + " hex=" + hex(v) + " str=" + new String(v).trim());
            next();
        }

        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            log("cccd " + d.getCharacteristic().getUuid() + " status=" + status);
            next();
        }

        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] v) {
            log("NOTIFY " + c.getUuid().toString().substring(4, 8) + " " + hex(v));
            if (!handshake || v.length < 5) return;
            int type = v[4] & 0xFF;
            if (type == 0xAA || type == 0xA5 || type == 0xA7) send(g, packet(0xB0, v[0] & 0xFF, 0));
            if (type == 0xAA) {
                long now = System.currentTimeMillis() / 1000;
                send(g, packet(0xC0, (int) (now >> 24) & 0xFF, (int) (now >> 16) & 0xFF, (int) (now >> 8) & 0xFF,
                    (int) now & 0xFF, 0x01, 0xA4, 0x01, 147, 0x11, 0xDA, 0x93, 0x13, 0x88, 0x13, 0x88, 0x2F,
                    UID >>> 24, (UID >> 16) & 0xFF, (UID >> 8) & 0xFF, UID & 0xFF, 0x01, 0x01, 0x02, 0x6B, 0x69));
                send(g, packet(0xC1, 0x01, 0x01, 147, 0x11, 0xDA, 0x93, 0x13, 0x88, 0x13, 0x88, 0x0F,
                    UID >>> 24, (UID >> 16) & 0xFF, (UID >> 8) & 0xFF, UID & 0xFF, 0x01, 0x01, 0x02, 0x6B, 0x69));
            }
        }

        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            log("WRITE status=" + status);
            next();
        }
    };

    /** idx, 00, len, 00, payload..., checksum = sum(payload) & 0x1F */
    private byte[] packet(int... payload) {
        byte[] b = new byte[payload.length + 5];
        b[0] = (byte) pkt;
        pkt = (pkt + 1) & 0xFF;
        b[2] = (byte) payload.length;
        int sum = 0;
        for (int i = 0; i < payload.length; i++) {
            b[4 + i] = (byte) payload[i];
            sum += payload[i] & 0xFF;
        }
        b[b.length - 1] = (byte) (sum & 0x1F);
        return b;
    }

    private void send(BluetoothGatt g, byte[] value) {
        BluetoothGattService s = g.getService(UUID.fromString("0000ffb0-0000-1000-8000-00805f9b34fb"));
        BluetoothGattCharacteristic c = s == null ? null : s.getCharacteristic(FFB1);
        if (c == null) { log("no FFB1"); return; }
        enqueue(() -> {
            log("WRITE ffb1 " + hex(value));
            g.writeCharacteristic(c, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        });
    }

    private void enableNotify(BluetoothGatt g, String prefix) {
        for (BluetoothGattService s : g.getServices())
            for (BluetoothGattCharacteristic c : s.getCharacteristics())
                if (c.getUuid().toString().startsWith(prefix)) subscribe(g, c);
    }

    private void subscribe(BluetoothGatt g, BluetoothGattCharacteristic c) {
        BluetoothGattDescriptor d = c.getDescriptor(CCCD);
        if (d == null) { log("no cccd on " + c.getUuid()); return; }
        byte[] v = (c.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
            ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
        enqueue(() -> {
            g.setCharacteristicNotification(c, true);
            g.writeDescriptor(d, v);
        });
    }

    private void enqueue(Runnable op) {
        synchronized (ops) {
            ops.add(op);
            if (!busy) next();
        }
    }

    private void next() {
        Runnable op;
        synchronized (ops) {
            op = ops.poll();
            busy = op != null;
        }
        if (op != null) op.run();
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        handshake = getIntent().getBooleanExtra("handshake", false);
        log("mode handshake=" + handshake);
        text = new TextView(this);
        text.setText("Waiting for MY_SCALE… tap the scale");
        setContentView(text);
        scanner = getSystemService(BluetoothManager.class).getAdapter().getBluetoothLeScanner();
        startScan();
    }

    private void startScan() {
        log("scanning");
        runOnUiThread(() -> text.setText("Waiting for MY_SCALE… tap the scale"));
        scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
    }

    @Override protected void onDestroy() {
        scanner.stopScan(scanCallback);
        if (gatt != null) gatt.close();
        super.onDestroy();
    }

    private static void log(String s) { Log.i(TAG, s); }

    private static String hex(byte[] a) {
        if (a == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte x : a) sb.append(String.format("%02X", x));
        return sb.toString();
    }
}
