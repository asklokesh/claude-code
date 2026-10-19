// Point the ralph-loop tests at this repository's plugin copy unless the caller overrides it.
import { join } from 'path';

process.env.RALPH_LOOP_DIR ??= join(import.meta.dir, '..', 'plugins', 'ralph-wiggum');
