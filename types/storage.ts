export interface QueryFilter {
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export interface Transaction {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  query<T>(collection: string, filter: QueryFilter): Promise<T[]>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): void;
}
