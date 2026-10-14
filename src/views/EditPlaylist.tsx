import type { FC } from "hono/jsx";
import type { PlaylistRow } from "../db/queries";

export const EditPlaylist: FC<{ playlist: PlaylistRow }> = ({ playlist }) => (
  <div>
    <p>
      <a href="/">&larr; Back</a>
    </p>
    <h1>Edit playlist</h1>
    <form class="edit-playlist" method="post" action={`/playlists/${playlist.id}/edit`}>
      <label>
        Name
        <input type="text" name="title" value={playlist.title ?? ""} required />
      </label>
      <label>
        YouTube playlist URL
        <input type="url" name="url" value={playlist.url} required />
      </label>
      <button type="submit">Save</button>
    </form>
  </div>
);
