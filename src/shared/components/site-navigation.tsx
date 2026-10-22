import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { NavigationIcon, type NavigationIconName } from "#/shared/components/navigation-icons";

type Tool = {
  description: string;
  icon: NavigationIconName;
  label: string;
} & ({ to: "/motionTransfer" } | { disabled: true });

type NavigationEntry = { label: string } & ({ disabled: true } | { tools: Tool[] });

const navigation: NavigationEntry[] = [
  //TODO: https://linear.app/devs3/issue/DEV-290
  { disabled: true, label: "Explore" },
  {
    label: "Image",
    tools: [
      //TODO: https://linear.app/devs3/issue/DEV-294
      {
        description: "Turn a description into a character image.",
        disabled: true,
        icon: "createCharacter",
        label: "Create character",
      },
    ],
  },
  {
    label: "Video",
    tools: [
      {
        description: "Make a character perform a reference motion.",
        icon: "motionTransfer",
        label: "Motion Transfer",
        to: "/motionTransfer",
      },
      //TODO: https://linear.app/devs3/issue/DEV-289
      {
        description: "Start with a ready-made motion and look.",
        disabled: true,
        icon: "motionPresets",
        label: "Motion presets",
      },
      //TODO: https://linear.app/devs3/issue/DEV-291
      {
        description: "Set the mood while directing your shot.",
        disabled: true,
        icon: "lookLighting",
        label: "Look & lighting",
      },
      //TODO: https://linear.app/devs3/issue/DEV-292
      {
        description: "Generate several takes and compare them.",
        disabled: true,
        icon: "batchVariations",
        label: "Batch variations",
      },
    ],
  },
  //TODO: https://linear.app/devs3/issue/DEV-288 — enable this category when an audio tool ships.
  { disabled: true, label: "Audio" },
  {
    label: "Library",
    tools: [
      //TODO: https://linear.app/devs3/issue/DEV-293
      {
        description: "Find and reuse your workspace's characters.",
        disabled: true,
        icon: "characters",
        label: "Characters",
      },
    ],
  },
];

function ToolDescription({ tool }: { tool: Tool }) {
  return (
    <span className="flex w-full items-start gap-3 py-1.5">
      <NavigationIcon name={tool.icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{tool.label}</span>
          {"disabled" in tool && <span className="text-xs text-muted-foreground">Soon</span>}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{tool.description}</span>
      </span>
    </span>
  );
}

export function SiteNavigation() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const motionTransfer =
    pathname === "/motionTransfer" || pathname.startsWith("/g/") || pathname.startsWith("/r/");

  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-0.5 sm:gap-1">
      {navigation.map((entry) => {
        if ("disabled" in entry) {
          return (
            <Button
              disabled
              key={entry.label}
              size="nav"
              title={`${entry.label} · Coming soon`}
              variant="ghost"
            >
              {entry.label}
              <span className="sr-only"> (coming soon)</span>
            </Button>
          );
        }

        const active = motionTransfer && entry.tools.some((tool) => "to" in tool);

        return (
          <DropdownMenu key={entry.label}>
            <DropdownMenuTrigger asChild>
              <Button size="nav" variant={active ? "secondary" : "ghost"}>
                {entry.label}
                <ChevronDownIcon aria-hidden="true" className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={16} sideOffset={8}>
              <div className="w-68">
                <DropdownMenuLabel>{entry.label}</DropdownMenuLabel>
                {entry.tools.map((tool) =>
                  "disabled" in tool ? (
                    <DropdownMenuItem disabled key={tool.label}>
                      <ToolDescription tool={tool} />
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem asChild key={tool.label}>
                      <Link aria-current={pathname === tool.to ? "page" : undefined} to={tool.to}>
                        <ToolDescription tool={tool} />
                      </Link>
                    </DropdownMenuItem>
                  ),
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
