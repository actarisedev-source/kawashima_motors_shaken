export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Enums: {
      reservation_status: "受付中" | "確定" | "完了" | "キャンセル";
    };
    Tables: {
      customers: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          normalized_phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string | null;
          normalized_phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>;
        Relationships: [];
      };
      vehicles: {
        Row: {
          id: string;
          customer_id: string;
          model_name: string;
          plate_number: string | null;
          shaken_expiry_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          model_name: string;
          plate_number?: string | null;
          shaken_expiry_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vehicles"]["Insert"]>;
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          customer_id: string;
          vehicle_id: string;
          reserved_at: string;
          confirmation_token: string;
          status: Database["public"]["Enums"]["reservation_status"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          vehicle_id: string;
          reserved_at: string;
          confirmation_token?: string;
          status?: Database["public"]["Enums"]["reservation_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reservations"]["Insert"]>;
        Relationships: [];
      };
      line_profiles: {
        Row: {
          id: string;
          customer_id: string | null;
          line_user_id: string;
          display_name: string | null;
          picture_url: string | null;
          followed_at: string | null;
          unfollowed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id?: string | null;
          line_user_id: string;
          display_name?: string | null;
          picture_url?: string | null;
          followed_at?: string | null;
          unfollowed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["line_profiles"]["Insert"]>;
        Relationships: [];
      };
      holidays: {
        Row: {
          id: string;
          type: "single" | "weekly";
          date: string | null;
          weekday: number | null;
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: "single" | "weekly";
          date?: string | null;
          weekday?: number | null;
          label?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["holidays"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
