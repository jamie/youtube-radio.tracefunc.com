import type { FC } from "hono/jsx";
import { buildWeekColumns, formatWeekLabel, groupVideosByWeek, type PlaylistWithVideos } from "../grid";
import { computeProgressGlyph } from "../progress-glyph";
import type { VideoRow } from "../db/queries";

const VideoIndicator: FC<{ video: VideoRow; week: string }> = ({ video, week }) => {
  const glyph = computeProgressGlyph(video.progress_seconds, video.duration_seconds);
  return (
    <button
      type="button"
      class="video"
      data-video-id={video.videoid}
      data-progress-seconds={video.progress_seconds}
      data-playlist-id={video.playlist_id}
      data-week={week}
      title={video.title}
    >
      <span class={`video-glyph ${glyph.state}`}>{glyph.char}</span>
    </button>
  );
};

// A week's videos for one playlist, all in a single wrapping flex row.
const VideoCell: FC<{ videos: VideoRow[]; week: string }> = ({ videos, week }) => (
  <div class="video-cell">
    {videos.map((video) => (
      <VideoIndicator key={video.videoid} video={video} week={week} />
    ))}
  </div>
);

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
                <th>{formatWeekLabel(week)}</th>
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
                      <VideoCell videos={grouped.get(week) ?? []} week={week} />
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
