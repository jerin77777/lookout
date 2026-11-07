import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// import env from './libs/env-vars/src/index';

export default {
    schema: './database/index.ts',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env['DATABASE_URL'],
    },
} satisfies Config;
