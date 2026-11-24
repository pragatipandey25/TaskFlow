import net from 'net';

export interface RedisParsedCommand {
  args: Buffer[];
  bytesConsumed: number;
}

export class MiniRedisServer {
  private server: net.Server;
  private clients = new Set<net.Socket>();
  private channelSubs = new Map<string, Set<net.Socket>>();
  private patternSubs = new Map<string, Set<net.Socket>>();
  private port = 0;

  constructor() {
    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      let buffer = Buffer.alloc(0);

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length > 0) {
          const parsed = this.parseCommand(buffer);
          if (!parsed) break;
          buffer = buffer.subarray(parsed.bytesConsumed);
          this.handleCommand(socket, parsed.args);
        }
      });

      socket.on('close', () => {
        this.cleanupSocket(socket);
      });

      socket.on('error', () => {
        this.cleanupSocket(socket);
      });
    });
  }

  private cleanupSocket(socket: net.Socket): void {
    this.clients.delete(socket);
    for (const set of this.channelSubs.values()) set.delete(socket);
    for (const set of this.patternSubs.values()) set.delete(socket);
  }

  public async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.end();
      }
    }
    this.clients.clear();
    this.channelSubs.clear();
    this.patternSubs.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  public getPort(): number {
    return this.port;
  }

  private parseCommand(buf: Buffer): RedisParsedCommand | null {
    if (buf.length === 0) return null;

    if (buf[0] !== 0x2a) {
      // Inline command (e.g. PING\r\n)
      const crlfIndex = buf.indexOf('\r\n');
      if (crlfIndex === -1) return null;
      const line = buf.subarray(0, crlfIndex).toString('utf8');
      const parts = line.split(' ').map((p) => Buffer.from(p));
      return { args: parts, bytesConsumed: crlfIndex + 2 };
    }

    // Array command: *<count>\r\n
    const crlfIndex = buf.indexOf('\r\n');
    if (crlfIndex === -1) return null;

    const countStr = buf.subarray(1, crlfIndex).toString('utf8');
    const numArgs = parseInt(countStr, 10);
    if (isNaN(numArgs)) return null;

    const args: Buffer[] = [];
    let offset = crlfIndex + 2;

    for (let i = 0; i < numArgs; i++) {
      if (offset >= buf.length) return null;
      if (buf[offset] !== 0x24) return null; // Expected '$'

      const nextCrlf = buf.indexOf('\r\n', offset);
      if (nextCrlf === -1) return null;

      const lenStr = buf.subarray(offset + 1, nextCrlf).toString('utf8');
      const argLen = parseInt(lenStr, 10);
      if (isNaN(argLen)) return null;

      const argStart = nextCrlf + 2;
      const argEnd = argStart + argLen;
      if (buf.length < argEnd + 2) return null; // Need whole argument + \r\n

      args.push(buf.subarray(argStart, argEnd));
      offset = argEnd + 2;
    }

    return { args, bytesConsumed: offset };
  }

  private handleCommand(socket: net.Socket, args: Buffer[]): void {
    if (!args || args.length === 0) return;
    const cmd = args[0].toString('utf8').toUpperCase();

    if (cmd === 'PING') {
      socket.write('+PONG\r\n');
    } else if (cmd === 'INFO') {
      const info = '# Server\r\nredis_version:7.2.0\r\n';
      socket.write(`$${info.length}\r\n${info}\r\n`);
    } else if (cmd === 'CLIENT') {
      socket.write('+OK\r\n');
    } else if (cmd === 'COMMAND') {
      socket.write('*0\r\n');
    } else if (cmd === 'SUBSCRIBE') {
      const channel = args[1]?.toString('utf8') || '';
      if (!this.channelSubs.has(channel)) this.channelSubs.set(channel, new Set());
      this.channelSubs.get(channel)!.add(socket);
      socket.write(`*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n:1\r\n`);
    } else if (cmd === 'PSUBSCRIBE') {
      const pattern = args[1]?.toString('utf8') || '';
      if (!this.patternSubs.has(pattern)) this.patternSubs.set(pattern, new Set());
      this.patternSubs.get(pattern)!.add(socket);
      socket.write(`*3\r\n$10\r\npsubscribe\r\n$${Buffer.byteLength(pattern)}\r\n${pattern}\r\n:1\r\n`);
    } else if (cmd === 'UNSUBSCRIBE') {
      const channels = args.slice(1).map((a) => a.toString('utf8'));
      if (channels.length === 0) {
        socket.write('*3\r\n$11\r\nunsubscribe\r\n$-1\r\n:0\r\n');
      } else {
        for (const channel of channels) {
          this.channelSubs.get(channel)?.delete(socket);
          socket.write(`*3\r\n$11\r\nunsubscribe\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n:0\r\n`);
        }
      }
    } else if (cmd === 'PUNSUBSCRIBE') {
      const patterns = args.slice(1).map((a) => a.toString('utf8'));
      if (patterns.length === 0) {
        socket.write('*3\r\n$12\r\npunsubscribe\r\n$-1\r\n:0\r\n');
      } else {
        for (const pattern of patterns) {
          this.patternSubs.get(pattern)?.delete(socket);
          socket.write(`*3\r\n$12\r\npunsubscribe\r\n$${Buffer.byteLength(pattern)}\r\n${pattern}\r\n:0\r\n`);
        }
      }
    } else if (cmd === 'PUBLISH') {
      const channel = args[1]?.toString('utf8') || '';
      const messageBuf = args[2] || Buffer.alloc(0);

      let count = 0;

      // Direct channel subscribers
      const channelClients = this.channelSubs.get(channel);
      if (channelClients) {
        const header = Buffer.from(
          `*3\r\n$7\r\nmessage\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${messageBuf.length}\r\n`
        );
        const trailer = Buffer.from('\r\n');
        const fullMsg = Buffer.concat([header, messageBuf, trailer]);
        for (const client of channelClients) {
          if (!client.destroyed && client.writable) {
            try {
              client.write(fullMsg);
              count++;
            } catch {
              this.cleanupSocket(client);
            }
          }
        }
      }

      // Pattern subscribers (e.g. socket.io#*)
      for (const [pattern, patternClients] of this.patternSubs.entries()) {
        const prefix = pattern.replace('*', '');
        if (channel.startsWith(prefix) || pattern === '*') {
          const header = Buffer.from(
            `*4\r\n$8\r\npmessage\r\n$${Buffer.byteLength(pattern)}\r\n${pattern}\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${messageBuf.length}\r\n`
          );
          const trailer = Buffer.from('\r\n');
          const fullMsg = Buffer.concat([header, messageBuf, trailer]);
          for (const client of patternClients) {
            if (!client.destroyed && client.writable) {
              try {
                client.write(fullMsg);
                count++;
              } catch {
                this.cleanupSocket(client);
              }
            }
          }
        }
      }

      socket.write(`:${count}\r\n`);
    } else if (cmd === 'QUIT') {
      socket.write('+OK\r\n', () => {
        socket.end();
      });
    } else {
      socket.write('+OK\r\n');
    }
  }
}
