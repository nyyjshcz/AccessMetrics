declare module "*.mjs" {
  export type AddressEntry = { address: string; ttl?: number } | string;
  export type ResolverAddressEntry = { address: string; ttl?: number } | string;
  export class DestinationPolicy {
    constructor(options?: {
      lookupAll?: (hostname: string) => Promise<AddressEntry[]>;
      resolverFactory?: () => {
        resolve4: (
          hostname: string,
          options?: { ttl?: boolean },
        ) => Promise<ResolverAddressEntry[]>;
        resolve6: (
          hostname: string,
          options?: { ttl?: boolean },
        ) => Promise<ResolverAddressEntry[]>;
        cancel?: () => void;
      };
    });
    lookup(hostname: string): Promise<{ host: string; addresses: string[] }>;
    resolve(
      hostname: string,
      port: number,
    ): Promise<{ host: string; port: number; address: string }>;
  }
  export function createProxyServer(options?: {
    policy?: DestinationPolicy;
  }): import("node:http").Server;
}
