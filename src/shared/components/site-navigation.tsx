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

type ToolPath = "/characters" | "/characters/new" | "/motionTransfer";

type Tool = { description: string; icon: NavigationIconName; label: string; to: ToolPath };

// The tools that ship, by category; a tool is listed once its page exists.
const navigation: Array<{ label: string; tools: Tool[] }> = [
  {
    label: "Image",
    tools: [
      {
        description: "Turn a description into a character image.",
        icon: "createCharacter",
        label: "Create character",
        to: "/characters/new",
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
    ],
  },
  {
    label: "Library",
    tools: [
      {
        description: "Find and reuse your workspace's characters.",
        icon: "characters",
        label: "Characters",
        to: "/characters",
      },
    ],
  },
];

function ToolDescription({ tool }: { tool: Tool }) {
  return (
    <span className="flex w-full items-start gap-3 py-1.5">
      <NavigationIcon name={tool.icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{tool.label}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{tool.description}</span>
      </span>
    </span>
  );
}

export function SiteNavigation() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // Each tool's pages: Motion Transfer's wizard and its takes' pages; the library and the builder
  // each their own page.
  const inTool = (to: ToolPath) =>
    to === "/motionTransfer"
      ? pathname === "/motionTransfer" || pathname.startsWith("/g/") || pathname.startsWith("/r/")
      : pathname === to;

  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-0.5 sm:gap-1">
      {navigation.map((entry) => (
        <DropdownMenu key={entry.label}>
          <DropdownMenuTrigger asChild>
            <Button
              size="nav"
              variant={entry.tools.some((tool) => inTool(tool.to)) ? "secondary" : "ghost"}
            >
              {entry.label}
              <ChevronDownIcon aria-hidden="true" className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" collisionPadding={16} sideOffset={8}>
            <div className="w-68">
              <DropdownMenuLabel>{entry.label}</DropdownMenuLabel>
              {entry.tools.map((tool) => (
                <DropdownMenuItem asChild key={tool.label}>
                  <Link aria-current={pathname === tool.to ? "page" : undefined} to={tool.to}>
                    <ToolDescription tool={tool} />
                  </Link>
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </nav>
  );
}
