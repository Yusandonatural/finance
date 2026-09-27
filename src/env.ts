export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  FREEE_COMPANY_ID: string;
  APP_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_MODE?: string;
  FREEE_CLIENT_ID?: string;
  FREEE_CLIENT_SECRET?: string;
  TOKEN_ENC_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { actor: string } };
