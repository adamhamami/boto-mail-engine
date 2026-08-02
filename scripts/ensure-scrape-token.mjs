import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const dest = path.join("monitoring", "prometheus", "scrape_token");
const src = path.join("monitoring", "prometheus", "scrape_token.example");

if (!existsSync(dest)) {
  copyFileSync(src, dest);
  console.log("Created monitoring/prometheus/scrape_token from example");
  console.log(
    "Set the same value in METRICS_SCRAPE_TOKEN (.env) before scraping.",
  );
} else {
  console.log("monitoring/prometheus/scrape_token already present");
}
