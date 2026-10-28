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

type ToolPath =
  | "/angles"
  | "/animate"
  | "/characters"
  | "/characters/new"
  | "/motionTransfer"
  | "/photoshoot"
  | "/presets"
  | "/product-studio"
  | "/storyboards";

/** A category of the main navigation that has shipped tools. */
export type NavigationCategory = "Image" | "Library" | "Video";

type Tool = {
  description: string;
  icon: NavigationIconName;
  label: string;
} & ({ to: ToolPath } | { disabled: true });

// Planned categories and tools are listed disabled, each under a comment naming its issue. A
// category that is one page (Explore) is a link to it, current on it and the pages under it.
type NavigationEntry =
  | { disabled: true; label: string }
  | { label: string; page: "/explore" }
  | { label: NavigationCategory; tools: Tool[] };

const navigation: NavigationEntry[] = [
  { label: "Explore", page: "/explore" },
  {
    label: "Image",
    tools: [
      {
        description: "Turn a description into a character image.",
        icon: "createCharacter",
        label: "Create character",
        to: "/characters/new",
      },
      {
        description: "Photograph a character in a new setting, four poses.",
        icon: "characters",
        label: "Photoshoot",
        to: "/photoshoot",
      },
      {
        description: "See a character from other camera angles.",
        icon: "createCharacter",
        label: "Shots & Angles",
        to: "/angles",
      },
      {
        description: "Tell a short sequence in four scenes of one character.",
        icon: "createCharacter",
        label: "Storyboard",
        to: "/storyboards",
      },
      {
        description: "Put a product photo in a packshot, lifestyle or ad scene.",
        icon: "lookLighting",
        label: "Product Studio",
        to: "/product-studio",
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
      {
        description: "Start with a ready-made motion and look.",
        icon: "motionPresets",
        label: "Motion presets",
        to: "/presets",
      },
      {
        description: "Bring a still image to life from a description.",
        icon: "motionTransfer",
        label: "Animate image",
        to: "/animate",
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
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{tool.label}</span>
          {"disabled" in tool && <span className="text-xs text-muted-foreground">Soon</span>}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{tool.description}</span>
      </span>
    </span>
  );
}

/**
 * The main navigation. A category is marked current on its tools' own pages, or when the page
 * says it belongs to it (`category`): a result or share page (`/g/:id`, `/r/:slug`) shows any
 * workflow's generation, so only the page knows whether it is a video or an image.
 */
export function SiteNavigation({ category }: { category?: NavigationCategory }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

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

        if ("page" in entry) {
          const here = pathname === entry.page || pathname.startsWith(`${entry.page}/`);

          return (
            <Button
              asChild
              data-current={here || undefined}
              key={entry.label}
              size="nav"
              variant={here ? "secondary" : "ghost"}
            >
              <Link aria-current={here ? "page" : undefined} to={entry.page}>
                {entry.label}
              </Link>
            </Button>
          );
        }

        const current =
          entry.label === category ||
          entry.tools.some((tool) => "to" in tool && pathname === tool.to);

        return (
          <DropdownMenu key={entry.label}>
            <DropdownMenuTrigger asChild>
              <Button
                data-current={current || undefined}
                size="nav"
                variant={current ? "secondary" : "ghost"}
              >
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
