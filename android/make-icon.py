# Generates the launcher icon (boat on a river at dusk) as PNG without external libraries.
import math, struct, sys, zlib
def png(path, n):
    rows = []
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            u, v = x / n, y / n
            r, g, b = 0.04 + 0.25 * (1 - v), 0.12 + 0.3 * (1 - v), 0.28 + 0.35 * (1 - v)   # dusk sky
            if v > 0.62:  # river
                w = 0.5 + 0.5 * math.sin(u * 40 + v * 90)
                r, g, b = 0.05, 0.32 + 0.08 * w, 0.45 + 0.1 * w
            d = math.hypot(u - 0.72, v - 0.3)  # moon / sun glow
            if d < 0.1: r, g, b = 1.0, 0.85, 0.5
            elif d < 0.22: k = (0.22 - d) / 0.12 * 0.5; r, g, b = r + k, g + k * 0.7, b + k * 0.3
            # boat hull
            if 0.58 < v < 0.68 and abs(u - 0.5) < 0.3 - (v - 0.58) * 1.5: r, g, b = 0.55, 0.32, 0.16
            # sail
            if 0.25 < v < 0.58 and 0.5 < u < 0.5 + (v - 0.25) * 0.75: r, g, b = 0.97, 0.93, 0.82
            if abs(u - 0.5) < 0.012 and 0.22 < v < 0.6: r, g, b = 0.35, 0.2, 0.1
            # rounded corners (transparent)
            cx, cy = min(u, 1 - u), min(v, 1 - v)
            a = 255
            if cx < 0.12 and cy < 0.12 and math.hypot(0.12 - cx, 0.12 - cy) > 0.12: a = 0
            row += bytes([min(255, int(r * 255)), min(255, int(g * 255)), min(255, int(b * 255)), a])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
png(sys.argv[1], 144); png(sys.argv[2], 48)
