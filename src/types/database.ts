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
          name_kana: string | null;
          phone: string | null;
          normalized_phone: string | null;
          birth_date: string | null;
          gender: "男性" | "女性" | "未設定";
          line_user_id: string | null;
          line_linked_at: string | null;
          line_display_name: string | null;
          line_picture_url: string | null;
          line_status: string;
          memo: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          name_kana?: string | null;
          phone?: string | null;
          normalized_phone?: string | null;
          birth_date?: string | null;
          gender?: "男性" | "女性" | "未設定";
          line_user_id?: string | null;
          line_linked_at?: string | null;
          line_display_name?: string | null;
          line_picture_url?: string | null;
          line_status?: string;
          memo?: string | null;
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
          memo: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          model_name: string;
          plate_number?: string | null;
          shaken_expiry_date?: string | null;
          memo?: string | null;
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
          note: string | null;
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
          note?: string | null;
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
      line_message_logs: {
        Row: {
          id: string;
          customer_id: string;
          line_user_id: string;
          target_type: string;
          title: string;
          body: string;
          image_url: string | null;
          status: "成功" | "失敗";
          error_message: string | null;
          sent_at: string | null;
          created_at: string;
          vehicle_id: string | null;
          reservation_id: string | null;
          automation_type: string | null;
          target_date: string | null;
        };
        Insert: {
          id?: string;
          customer_id: string;
          line_user_id: string;
          target_type: string;
          title: string;
          body: string;
          image_url?: string | null;
          status: "成功" | "失敗";
          error_message?: string | null;
          sent_at?: string | null;
          created_at?: string;
          vehicle_id?: string | null;
          reservation_id?: string | null;
          automation_type?: string | null;
          target_date?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["line_message_logs"]["Insert"]
        >;
        Relationships: [];
      };
      line_automation_settings: {
        Row: {
          id: string;
          automation_type:
            | "shaken_60_days"
            | "shaken_30_days"
            | "reservation_previous_day";
          enabled: boolean;
          title: string;
          body: string;
          send_time: string;
          last_run_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          automation_type:
            | "shaken_60_days"
            | "shaken_30_days"
            | "reservation_previous_day";
          enabled?: boolean;
          title: string;
          body: string;
          send_time?: string;
          last_run_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["line_automation_settings"]["Insert"]
        >;
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
      slot_settings: {
        Row: {
          id: string;
          slot_type: string;
          weekday: number;
          time: string;
          capacity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slot_type?: string;
          weekday: number;
          time: string;
          capacity: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["slot_settings"]["Insert"]>;
        Relationships: [];
      };
      special_slot_settings: {
        Row: {
          id: string;
          slot_type: string;
          date: string;
          time: string;
          capacity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slot_type?: string;
          date: string;
          time: string;
          capacity: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["special_slot_settings"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_reservation_atomic: {
        Args: {
          p_customer_name: string;
          p_customer_kana: string | null;
          p_phone: string;
          p_normalized_phone: string;
          p_vehicle_model: string;
          p_license_plate: string | null;
          p_shaken_expiry_date: string | null;
          p_reserved_at: string;
          p_note: string | null;
          p_line_user_id: string | null;
          p_line_display_name: string | null;
          p_line_picture_url: string | null;
          p_slot_type?: string;
        };
        Returns: Array<{
          reservation_id: string;
          reservation_status: string;
          confirmation_token: string;
          customer_id: string;
          vehicle_id: string;
          line_linked: boolean;
          line_link_warning: string | null;
        }>;
      };
    };
  };
};
