interface ImportMetaEnv {
  readonly VITE_CATALOG_API?: string;
  readonly VITE_INVENTORY_API?: string;
  readonly VITE_ORDER_API?: string;
  readonly VITE_NOTIFICATION_API?: string;
  readonly VITE_NOTIFICATION_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
