import linkPreviews from "@yielded/starlight-theme/link-previews";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://yielded.dev",
  integrations: [linkPreviews()],
});
