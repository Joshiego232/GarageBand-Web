import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

interface Database {
  public: {
    Tables: {
      saved_projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          project: Json;
          assets: Json;
          updated_at: string;
          created_at: string;
          last_opened_at: string | null;
          preview: string | null;
        };
        Insert: {
          id: string;
          user_id: string;
          name: string;
          project: Json;
          assets: Json;
          updated_at?: string;
          created_at?: string;
          last_opened_at?: string | null;
          preview?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          project?: Json;
          assets?: Json;
          updated_at?: string;
          created_at?: string;
          last_opened_at?: string | null;
          preview?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

let browserClient: SupabaseClient<Database> | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}
