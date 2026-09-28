import type { FC } from "hono/jsx";
import { buildWeekColumns, groupVideosByWeek, type PlaylistWithVideos } from "../grid";
import { computeProgressGlyph } from "../progress-glyph";
import type { VideoRow } from "../db/queries";

const VideoIndicator: FC<{ video: VideoRow }> = ({ video }) => {
  const glyph = computeProgressGlyph(video.progress_seconds, video.duration_seconds);
  return (
    <button
      type="button"
      class="video"
      data-video-id={video.videoid}
      data-progress-seconds={video.progress_seconds}
      title={video.title}
    >
      <span class={`video-glyph ${glyph.state}`}>{glyph.char}</span>
      <span class="video-title">{video.title}</span>
    </button>
  );
};

export const Grid: FC<{ playlists: PlaylistWithVideos[] }> = ({ playlists }) => {
  const weeks = buildWeekColumns(playlists);

  return (
    <div>
      <form class="subscribe" method="post" action="/playlists">
        <input type="url" name="url" placeholder="YouTube playlist URL" required />
        <button type="submit">Subscribe</button>
      </form>

      {playlists.length === 0 ? (
        <p>No playlists yet — subscribe to one above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Playlist</th>
              {weeks.map((week) => (
                <th>{week}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playlists.map((playlist) => {
              const grouped = groupVideosByWeek(playlist);
              return (
                <tr>
                  <th>{playlist.title ?? playlist.youtube_playlist_id}</th>
                  {weeks.map((week) => (
                    <td>
                      {(grouped.get(week) ?? []).map((video) => (
                        <VideoIndicator video={video} />
                      ))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
