import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.OWB_DATA_DIR || join(homedir(), '.wechat-opencode-bot');
