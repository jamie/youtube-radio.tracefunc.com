import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren> = ({ children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>youtube-feed</title>
      <style>{`
        body { font-family: system-ui, sans-serif; margin: 1.5rem; }
        #player { margin-bottom: 1.5rem; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 0.4rem; vertical-align: top; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; white-space: nowrap; }
        .video-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.4rem;
                      padding: 0.15rem 0; }
        .video { display: inline-block; flex: none; cursor: pointer; border: none; background: none;
                 padding: 0; font-size: 1rem; }
        .video-glyph { display: inline-block; width: 1.2em; border-radius: 2px; }
        .video-glyph.unwatched { color: #bbb; }
        .video-glyph.in-progress { color: #d18b00; }
        .video-glyph.done { color: #2a8f4d; }
        form.subscribe { margin-bottom: 1.5rem; display: flex; gap: 0.5rem; }
        form.subscribe input { flex: 1; padding: 0.4rem; }
      `}</style>
    </head>
    <body>
      <div id="player"></div>
      {children}
      <script src="/player.js"></script>
    </body>
  </html>
);
