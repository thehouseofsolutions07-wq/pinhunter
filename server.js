// Entry point for web hosts (Hostinger Node.js, Render, a VPS…): runs the dashboard with password login.
// Needs PINHUNTER_PUBLIC_URL, PINHUNTER_PASSWORD and PINHUNTER_UI_TOKEN set as environment variables.
import { runHosted } from './src/cli/ui.js';

runHosted().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
