using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LogoAdapt
{
    public static void Run(string src, string dst)
    {
        Bitmap srcBmp = new Bitmap(src);
        Bitmap bmp = new Bitmap(srcBmp.Width, srcBmp.Height, PixelFormat.Format32bppArgb);
        Graphics g = Graphics.FromImage(bmp);
        g.DrawImage(srcBmp, 0, 0, srcBmp.Width, srcBmp.Height);
        g.Dispose();
        srcBmp.Dispose();

        Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int w = bmp.Width;
        int h = bmp.Height;
        int stride = data.Stride;
        byte[] px = new byte[Math.Abs(stride) * h];
        Marshal.Copy(data.Scan0, px, 0, px.Length);

        bool[] vis = new bool[w * h];
        Queue<int> q = new Queue<int>();
        EnqueueEdge(px, vis, q, w, h, stride);

        int[] dx = new int[] { 1, -1, 0, 0, 1, 1, -1, -1 };
        int[] dy = new int[] { 0, 0, 1, -1, 1, -1, 1, -1 };
        while (q.Count > 0)
        {
            int k = q.Dequeue();
            int x = k % w;
            int y = k / w;
            int i = y * stride + x * 4;
            px[i] = 0x8C;
            px[i + 1] = 0xDC;
            px[i + 2] = 0xE8;
            px[i + 3] = 255;
            for (int t = 0; t < 4; t++)
            {
                TryEnq(px, vis, q, w, h, stride, x + dx[t], y + dy[t]);
            }
        }

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int k = y * w + x;
                if (vis[k]) continue;
                int i = y * stride + x * 4;
                int b = px[i];
                int gv = px[i + 1];
                int r = px[i + 2];
                int L = (r * 299 + gv * 587 + b * 114) / 1000;
                if (L < 40)
                {
                    px[i] = 0x14;
                    px[i + 1] = 0x18;
                    px[i + 2] = 0x1C;
                    continue;
                }
                if (b > r + 6 && b > 88 && gv > 100)
                {
                    int nr = Math.Min(255, (int)(L * 1.08 + 22));
                    int ng = Math.Min(255, (int)(L * 1.02 + 12));
                    int nb = Math.Min(255, (int)(L * 0.72 + 8));
                    px[i] = (byte)nb;
                    px[i + 1] = (byte)ng;
                    px[i + 2] = (byte)nr;
                    continue;
                }
                int nr2 = Math.Min(255, r + 8);
                int ng2 = Math.Min(255, gv + 2);
                int nb2 = Math.Min(255, (int)(b * 0.78));
                px[i] = (byte)nb2;
                px[i + 1] = (byte)ng2;
                px[i + 2] = (byte)nr2;
            }
        }

        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
        bmp.Save(dst, ImageFormat.Png);
        bmp.Dispose();
    }

    static bool DarkBg(byte[] px, int stride, int x, int y)
    {
        int i = y * stride + x * 4;
        int b = px[i];
        int gv = px[i + 1];
        int r = px[i + 2];
        int L = (r * 299 + gv * 587 + b * 114) / 1000;
        int mx = Math.Max(r, Math.Max(gv, b));
        int mn = Math.Min(r, Math.Min(gv, b));
        int sat = mx == 0 ? 0 : (mx - mn) * 100 / mx;
        return L < 68 && mx < 118 && sat < 48;
    }

    static void TryEnq(byte[] px, bool[] vis, Queue<int> q, int w, int h, int stride, int x, int y)
    {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        int k = y * w + x;
        if (vis[k] || !DarkBg(px, stride, x, y)) return;
        vis[k] = true;
        q.Enqueue(k);
    }

    static void EnqueueEdge(byte[] px, bool[] vis, Queue<int> q, int w, int h, int stride)
    {
        for (int x = 0; x < w; x++)
        {
            TryEnq(px, vis, q, w, h, stride, x, 0);
            TryEnq(px, vis, q, w, h, stride, x, h - 1);
        }
        for (int y = 0; y < h; y++)
        {
            TryEnq(px, vis, q, w, h, stride, 0, y);
            TryEnq(px, vis, q, w, h, stride, w - 1, y);
        }
    }
}
