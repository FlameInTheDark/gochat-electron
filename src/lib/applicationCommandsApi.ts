import { axiosInstance } from "@/api/client";
import { getApiBaseUrl } from "@/lib/connectionConfig";
import type { Snowflake } from "@/lib/botsApi";

export type ApplicationCommandType = 1 | 2 | 3;
export type ApplicationCommandOptionType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface ApplicationCommandChoice {
  name: string;
  name_localizations?: Record<string, string>;
  value: string | number | boolean;
}

export interface ApplicationCommandOption {
  type: ApplicationCommandOptionType;
  name: string;
  description: string;
  required?: boolean;
  choices?: ApplicationCommandChoice[];
  options?: ApplicationCommandOption[];
  autocomplete?: boolean;
  channel_types?: number[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
}

export interface ApplicationCommand {
  id: Snowflake;
  application_id: Snowflake;
  bot_id?: Snowflake;
  guild_id?: Snowflake | null;
  version?: Snowflake;
  type: ApplicationCommandType;
  name: string;
  description?: string;
  options?: ApplicationCommandOption[];
  default_member_permissions?: Snowflake | null;
  contexts?: number[];
  integration_types?: number[];
  nsfw?: boolean;
  bot_name?: string;
  application_icon?: string | null;
}

export interface ApplicationCommandIndexApplication {
  id: Snowflake;
  name: string;
  description?: string;
  icon?: string | null;
  bot_id: Snowflake;
  flags?: string;
}

export interface ApplicationCommandIndex {
  applications: ApplicationCommandIndexApplication[];
  application_commands: ApplicationCommand[];
  version: Snowflake;
}

export interface InteractionOptionValue {
  name: string;
  type: ApplicationCommandOptionType;
  value?: string | number | boolean;
  options?: InteractionOptionValue[];
  focused?: boolean;
}

export interface InvokeApplicationCommandRequest {
  command_id: Snowflake;
  channel_id: Snowflake;
  guild_id?: Snowflake;
  options?: InteractionOptionValue[];
  target_id?: Snowflake;
  locale?: string;
}

export interface InvokeApplicationCommandResponse {
  interaction_id: Snowflake;
  state: string;
  message?: unknown;
  ephemeral?: unknown;
  choices?: ApplicationCommandChoice[];
  error?: string;
}

const apiBase = () => getApiBaseUrl();
const id = (value: Snowflake) => encodeURIComponent(String(value));

export const applicationCommandsApi = {
  async guildCommandIndex(guildId: Snowflake): Promise<ApplicationCommandIndex> {
    const response = await axiosInstance.get<ApplicationCommandIndex>(
      `${apiBase()}/guilds/${id(guildId)}/application-command-index`,
    );
    const applications = response.data?.applications ?? [];
    const applicationById = new Map(
      applications.map((application) => [String(application.id), application] as const),
    );
    return {
      applications,
      application_commands: (response.data?.application_commands ?? []).map((command) => {
        const application = applicationById.get(String(command.application_id));
        return {
          ...command,
          bot_id: command.bot_id ?? application?.bot_id,
          bot_name: command.bot_name ?? application?.name,
          application_icon: application?.icon ?? null,
        };
      }),
      version: response.data?.version ?? '0',
    };
  },

  async listVisible(params: {
    channelId: Snowflake;
    guildId?: Snowflake;
    type?: ApplicationCommandType;
    query?: string;
  }): Promise<ApplicationCommand[]> {
    const response = await axiosInstance.get<ApplicationCommand[]>(
      `${apiBase()}/application-commands`,
      {
        params: {
          channel_id: params.channelId,
          guild_id: params.guildId,
          type: params.type ?? 1,
          query: params.query,
        },
      },
    );
    return response.data ?? [];
  },

  async invoke(request: InvokeApplicationCommandRequest): Promise<InvokeApplicationCommandResponse> {
    const response = await axiosInstance.post<InvokeApplicationCommandResponse>(
      `${apiBase()}/application-commands/interactions`,
      request,
    );
    return response.data;
  },

  async autocomplete(request: InvokeApplicationCommandRequest): Promise<InvokeApplicationCommandResponse> {
    const response = await axiosInstance.post<InvokeApplicationCommandResponse>(
      `${apiBase()}/application-commands/autocomplete`,
      request,
    );
    return response.data;
  },

  async listDeveloperCommands(botId: Snowflake, guildId?: Snowflake): Promise<ApplicationCommand[]> {
    const response = await axiosInstance.get<ApplicationCommand[]>(
      `${apiBase()}/developer/bots/${id(botId)}/commands`,
      { params: guildId ? { guild_id: guildId } : undefined },
    );
    return response.data ?? [];
  },

  async createDeveloperCommand(botId: Snowflake, command: Partial<ApplicationCommand>, guildId?: Snowflake): Promise<ApplicationCommand> {
    const response = await axiosInstance.post<ApplicationCommand>(
      `${apiBase()}/developer/bots/${id(botId)}/commands`,
      command,
      { params: guildId ? { guild_id: guildId } : undefined },
    );
    return response.data;
  },

  async bulkOverwriteDeveloperCommands(botId: Snowflake, commands: Partial<ApplicationCommand>[], guildId?: Snowflake): Promise<ApplicationCommand[]> {
    const response = await axiosInstance.put<ApplicationCommand[]>(
      `${apiBase()}/developer/bots/${id(botId)}/commands`,
      commands,
      { params: guildId ? { guild_id: guildId } : undefined },
    );
    return response.data ?? [];
  },

  async deleteDeveloperCommand(botId: Snowflake, commandId: Snowflake): Promise<void> {
    await axiosInstance.delete(`${apiBase()}/developer/bots/${id(botId)}/commands/${id(commandId)}`);
  },
};
