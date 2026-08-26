export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      join_attempts: {
        Row: {
          created_at: string
          id: string
          ip: unknown
          room_id: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: unknown
          room_id?: string | null
          success: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: unknown
          room_id?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_attempts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_attempts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          counts_toward_quota: boolean
          created_at: string
          deleted_at: string | null
          hidden_by_admin: boolean
          id: string
          image_path: string
          room_id: string
          rotation_deg: number
          theme_id: string | null
          thumb_path: string
          type: Database["public"]["Enums"]["post_type"]
          updated_at: string
          week_start_date: string
        }
        Insert: {
          author_id: string
          body: string
          counts_toward_quota?: boolean
          created_at?: string
          deleted_at?: string | null
          hidden_by_admin?: boolean
          id?: string
          image_path: string
          room_id: string
          rotation_deg?: number
          theme_id?: string | null
          thumb_path: string
          type: Database["public"]["Enums"]["post_type"]
          updated_at?: string
          week_start_date: string
        }
        Update: {
          author_id?: string
          body?: string
          counts_toward_quota?: boolean
          created_at?: string
          deleted_at?: string | null
          hidden_by_admin?: boolean
          id?: string
          image_path?: string
          room_id?: string
          rotation_deg?: number
          theme_id?: string | null
          thumb_path?: string
          type?: Database["public"]["Enums"]["post_type"]
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "room_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          room_id: string
          status: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          room_id: string
          status?: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          room_id?: string
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          background_image_url: string | null
          created_at: string
          description: string | null
          id: string
          join_code: string
          join_open: boolean
          name: string
        }
        Insert: {
          background_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          join_code: string
          join_open?: boolean
          name: string
        }
        Update: {
          background_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          join_code?: string
          join_open?: boolean
          name?: string
        }
        Relationships: []
      }
      themes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          room_id: string
          title: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          room_id: string
          title: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          room_id?: string
          title?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "themes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "themes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      posts_public: {
        Row: {
          body: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          image_path: string | null
          room_id: string | null
          rotation_deg: number | null
          theme_id: string | null
          thumb_path: string | null
          type: Database["public"]["Enums"]["post_type"] | null
          week_start_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms_public: {
        Row: {
          background_image_url: string | null
          description: string | null
          id: string | null
          join_open: boolean | null
          name: string | null
        }
        Insert: {
          background_image_url?: string | null
          description?: string | null
          id?: string | null
          join_open?: boolean | null
          name?: string | null
        }
        Update: {
          background_image_url?: string | null
          description?: string | null
          id?: string | null
          join_open?: boolean | null
          name?: string | null
        }
        Relationships: []
      }
      themes_public: {
        Row: {
          description: string | null
          id: string | null
          room_id: string | null
          title: string | null
          week_start_date: string | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          room_id?: string | null
          title?: string | null
          week_start_date?: string | null
        }
        Update: {
          description?: string | null
          id?: string | null
          room_id?: string | null
          title?: string | null
          week_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "themes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "themes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cleanup_deleted_posts: {
        Args: never
        Returns: {
          deleted_objects: number
          deleted_rows: number
        }[]
      }
      current_week_start: { Args: never; Returns: string }
      is_active_member: { Args: { rid: string }; Returns: boolean }
      is_admin: { Args: { rid: string }; Returns: boolean }
      mask_name: { Args: { n: string }; Returns: string }
      soft_delete_post: { Args: { p_id: string }; Returns: undefined }
    }
    Enums: {
      member_role: "member" | "admin"
      member_status: "active" | "suspended" | "left"
      post_type: "theme" | "free"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      member_role: ["member", "admin"],
      member_status: ["active", "suspended", "left"],
      post_type: ["theme", "free"],
    },
  },
} as const
