# 街球 PK 联机池

比赛页 PK 默认写在**这台浏览器的 localStorage**，本机就能测。同事互打需要把这个 Worker 部署到 Cloudflare：

1. 在 Cloudflare 建一个 KV，名字随意。
2. 把 `wrangler.toml` 里的 `id` 换成 KV 的 ID。
3. 部署后得到形如 `https://fs-bokemon-pk.xxx.workers.dev` 的地址。
4. 在 `FS-POKEMAN/.env` 写：

```
VITE_PK_API=https://fs-bokemon-pk.xxx.workers.dev
```

然后重新开一次 `npm run dev`。
