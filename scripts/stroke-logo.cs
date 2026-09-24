using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class LogoStrokeApp
{
    public static int Main(string[] args)
    {
        if (args == null || args.Length < 2)
        {
            Console.Error.WriteLine("usage: stroke-logo <src> <dst>");
            return 1;
        }
        Run(args[0], args[1]);
        return 0;
    }

    public static void Run(string src, string dst)
    {
        Bitmap srcBmp = new Bitmap(src);
        int w = srcBmp.Width;
        int h = srcBmp.Height;
        Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        Graphics g = Graphics.FromImage(bmp);
        g.DrawImage(srcBmp, 0, 0, w, h);
        g.Dispose();
        srcBmp.Dispose();

        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] px = new byte[Math.Abs(stride) * h];
        Marshal.Copy(data.Scan0, px, 0, px.Length);

        bool[] letter = new bool[w * h];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                int b = px[i];
                int gv = px[i + 1];
                int r = px[i + 2];
                letter[y * w + x] = IsLetter(r, gv, b);
            }
        }

        int rad = Math.Max(8, w / 80);
        bool[] stroke = Dilate(letter, w, h, rad);

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int k = y * w + x;
                int i = y * stride + x * 4;
                if (letter[k])
                {
                    int b = px[i];
                    int gv = px[i + 1];
                    int r = px[i + 2];
                    if (IsGold(r, gv, b))
                    {
                        px[i] = (byte)Math.Max(0, b - 18);
                        px[i + 1] = (byte)Math.Min(255, gv + 6);
                        px[i + 2] = (byte)Math.Min(255, r + 10);
                    }
                    else
                    {
                        px[i] = 208;
                        px[i + 1] = 244;
                        px[i + 2] = 255;
                    }
                    px[i + 3] = 255;
                }
                else if (stroke[k])
                {
                    px[i] = 18;
                    px[i + 1] = 16;
                    px[i + 2] = 14;
                    px[i + 3] = 255;
                }
                else
                {
                    px[i] = 0;
                    px[i + 1] = 0;
                    px[i + 2] = 0;
                    px[i + 3] = 0;
                }
            }
        }

        int minX = w, minY = h, maxX = 0, maxY = 0;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                if (px[i + 3] < 16) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);

        int pad = 8;
        minX = Math.Max(0, minX - pad);
        minY = Math.Max(0, minY - pad);
        maxX = Math.Min(w - 1, maxX + pad);
        maxY = Math.Min(h - 1, maxY + pad);
        int cw = maxX - minX + 1;
        int ch = maxY - minY + 1;
        Bitmap cropped = new Bitmap(cw, ch, PixelFormat.Format32bppArgb);
        Graphics cg = Graphics.FromImage(cropped);
        cg.Clear(Color.Transparent);
        cg.DrawImage(bmp, new Rectangle(0, 0, cw, ch), new Rectangle(minX, minY, cw, ch), GraphicsUnit.Pixel);
        cg.Dispose();
        bmp.Dispose();
        cropped.Save(dst, ImageFormat.Png);
        cropped.Dispose();
        Console.WriteLine("wrote " + dst + " " + cw + "x" + ch + " stroke=" + rad);
    }

    static bool[] Dilate(bool[] src, int w, int h, int rad)
    {
        bool[] dst = new bool[w * h];
        int r2 = rad * rad;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (!src[y * w + x]) continue;
                int y0 = Math.Max(0, y - rad);
                int y1 = Math.Min(h - 1, y + rad);
                int x0 = Math.Max(0, x - rad);
                int x1 = Math.Min(w - 1, x + rad);
                for (int yy = y0; yy <= y1; yy++)
                {
                    int dy = yy - y;
                    for (int xx = x0; xx <= x1; xx++)
                    {
                        int dx = xx - x;
                        if (dx * dx + dy * dy <= r2) dst[yy * w + xx] = true;
                    }
                }
            }
        }
        return dst;
    }

    static bool IsLetter(int r, int g, int b)
    {
        return IsGold(r, g, b) || IsLightType(r, g, b);
    }

    static bool IsGold(int r, int g, int b)
    {
        int L = (r * 299 + g * 587 + b * 114) / 1000;
        return r >= 148 && g >= 78 && r >= g - 12 && r > b + 28 && g > b + 8 && L >= 78;
    }

    static bool IsLightType(int r, int g, int b)
    {
        int L = (r * 299 + g * 587 + b * 114) / 1000;
        int mx = Math.Max(r, Math.Max(g, b));
        int mn = Math.Min(r, Math.Min(g, b));
        int sat = mx == 0 ? 0 : (mx - mn) * 100 / mx;
        if (L >= 168 && sat <= 42) return true;
        return L >= 150 && b >= 170 && g >= 150 && b + 8 >= r;
    }
}
