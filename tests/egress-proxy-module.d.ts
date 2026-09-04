declare module "*.mjs" {
  export type AddressEntry = { address: string } | string;
  export class DestinationPolicy {
    constructor(options?: {
      lookupAll?: (hostname: string) => Promise<AddressEntry[]>;
      resolverFactory?: () => {
        resolve4: (hostname: string) => Promise<string[]>;
        resolve6: (hostname: string) => Promise<string[]>;
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
