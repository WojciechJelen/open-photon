import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import animateImage from "#/shared/assets/navigation/animate-image.webp";
import batches from "#/shared/assets/navigation/batches.webp";
import createCharacter from "#/shared/assets/navigation/create-character.webp";
import motionPresets from "#/shared/assets/navigation/motion-presets.webp";
import motionTransfer from "#/shared/assets/navigation/motion-transfer.webp";
import photoshoot from "#/shared/assets/navigation/photoshoot.webp";
import productStudio from "#/shared/assets/navigation/product-studio.webp";
import shotsAndAngles from "#/shared/assets/navigation/shots-and-angles.webp";
import spriteForge from "#/shared/assets/navigation/sprite-forge.webp";
import storyboard from "#/shared/assets/navigation/storyboard.webp";
import { BrandMark, Hud } from "#/shared/components/brand";

type ToolPath =
  | "/angles"
  | "/animate"
  | "/batches"
  | "/characters/new"
  | "/motionTransfer"
  | "/photoshoot"
  | "/presets"
  | "/product-studio"
  | "/sprites"
  | "/storyboards";

/** A category of the main navigation, a menu of shipped tools. */
export type NavigationCategory = "Image" | "Video";

type Tool = { caption: string; label: string; thumbnail: string; to: ToolPath };

const menus: { label: NavigationCategory; tools: Tool[]; wide?: boolean }[] = [
  {
    label: "Image",
    tools: [
      {
        caption: "From a description",
        label: "Create character",
        thumbnail: createCharacter,
        to: "/characters/new",
      },
      {
        caption: "Four new photos",
        label: "Photoshoot",
        thumbnail: photoshoot,
        to: "/photoshoot",
      },
      {
        caption: "Every side of a character",
        label: "Shots & Angles",
        thumbnail: shotsAndAngles,
        to: "/angles",
      },
      { caption: "Four scenes", label: "Storyboard", thumbnail: storyboard, to: "/storyboards" },
      {
        caption: "Walk cycles for games",
        label: "Sprite Forge",
        thumbnail: spriteForge,
        to: "/sprites",
      },
      {
        caption: "Packshots and ad scenes",
        label: "Product Studio",
        thumbnail: productStudio,
        to: "/product-studio",
      },
    ],
    wide: true,
  },
  {
    label: "Video",
    tools: [
      {
        caption: "Any character, any move",
        label: "Motion Transfer",
        thumbnail: motionTransfer,
        to: "/motionTransfer",
      },
      {
        caption: "Ready-made shots",
        label: "Motion presets",
        thumbnail: motionPresets,
        to: "/presets",
      },
      {
        caption: "Bring a still to life",
        label: "Animate image",
        thumbnail: animateImage,
        to: "/animate",
      },
      { caption: "Compare variations", label: "Batches", thumbnail: batches, to: "/batches" },
    ],
  },
];

const tools = menus.flatMap((menu) => menu.tools);

function isUnder(pathname: string, page: string) {
  return pathname === page || pathname.startsWith(`${page}/`);
}

/** Whether `page`, a plain link of the navigation, is the page shown or one under it. */
function isCurrentPage(pathname: string, page: "/characters" | "/explore") {
  // `/characters/new` is under `/characters` but is a tool of its own, in the Image menu.
  return isUnder(pathname, page) && !tools.some((tool) => pathname === tool.to);
}

function usePathname() {
  return useRouterState({ select: (state) => state.location.pathname });
}

/** A tool: its 48 px picture, its name and what it does; the page's own says so with a check. */
function ToolTile({ current, tool }: { current: boolean; tool: Tool }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-3">
      <img
        alt=""
        className="size-12 shrink-0 rounded-md bg-screen object-cover"
        decoding="async"
        draggable={false}
        height={48}
        src={tool.thumbnail}
        width={48}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{tool.label}</span>
        <span className="truncate type-caption text-muted-foreground">{tool.caption}</span>
      </span>
      {current && <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-brand" />}
    </span>
  );
}

/** A plain link of the navigation. Its semibold width is kept, so being current moves nothing. */
function PageLink({ label, to }: { label: string; to: "/characters" | "/explore" }) {
  const here = isCurrentPage(usePathname(), to);

  return (
    <Button asChild data-current={here || undefined} size="nav" variant="ghost">
      <Link activeOptions={{ exact: true }} aria-current={here ? "page" : undefined} to={to}>
        <span className="reserve-semibold" data-label={label}>
          {label}
        </span>
      </Link>
    </Button>
  );
}

/**
 * The main navigation, from `nav` up. A category is marked current on its tools' own pages, or
 * when the page says it belongs to it (`category`): a result or share page (`/g/:id`, `/r/:slug`)
 * shows any workflow's generation, so only the page knows whether it is a video or an image.
 */
export function SiteNavigation({ category }: { category?: NavigationCategory }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex items-center gap-0.5">
      <PageLink label="Explore" to="/explore" />
      {menus.map((menu) => {
        const current = menu.label === category || menu.tools.some((tool) => pathname === tool.to);

        return (
          <DropdownMenu key={menu.label}>
            <DropdownMenuTrigger asChild>
              <Button data-current={current || undefined} size="nav" variant="ghost">
                <span className="reserve-semibold" data-label={menu.label}>
                  {menu.label}
                </span>
                <ChevronDownIcon aria-hidden="true" className="size-3.25" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={16} sideOffset={8}>
              <div className={cn("grid gap-0.5", menu.wide ? "w-146 grid-cols-2" : "w-71")}>
                {menu.tools.map((tool) => (
                  <DropdownMenuItem
                    asChild
                    data-current={pathname === tool.to || undefined}
                    key={tool.to}
                  >
                    <Link aria-current={pathname === tool.to ? "page" : undefined} to={tool.to}>
                      <ToolTile current={pathname === tool.to} tool={tool} />
                    </Link>
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      <PageLink label="Characters" to="/characters" />
    </nav>
  );
}

/** A row of the phone menu: a tool, or a plain page. */
function PhoneLink({
  children,
  close,
  current,
  to,
}: {
  children: ReactNode;
  close: () => void;
  current: boolean;
  to: ToolPath | "/characters" | "/explore";
}) {
  return (
    <Link
      activeOptions={{ exact: true }}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 min-w-0 items-center rounded-xl p-2 type-body font-medium text-soft-foreground hover:bg-foreground/6 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        current && "bg-accent font-semibold text-foreground",
      )}
      onClick={close}
      to={to}
    >
      {children}
    </Link>
  );
}

/**
 * The navigation below `nav`: a menu button that opens every link on a sheet over the page, with
 * `children` (the session and GitHub, given the way to close the sheet) at its end.
 */
export function PhoneMenu({
  category,
  children,
}: {
  category?: NavigationCategory;
  children: (close: () => void) => ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <span className="nav:hidden">
        <DialogTrigger asChild>
          <Button aria-label="Open the menu" size="icon" variant="ghost">
            <MenuIcon aria-hidden="true" className="size-5 text-foreground" strokeWidth={1.75} />
          </Button>
        </DialogTrigger>
      </span>
      <DialogContent aria-describedby={undefined} showCloseButton={false} size="sheet">
        <span className="sr-only">
          <DialogTitle>Menu</DialogTitle>
        </span>
        <div className="flex h-15 shrink-0 items-center justify-between border-b pr-2 pl-4">
          <BrandMark />
          <DialogClose asChild>
            <Button aria-label="Close the menu" size="icon" variant="ghost">
              <XIcon aria-hidden="true" className="size-5 text-foreground" strokeWidth={1.75} />
            </Button>
          </DialogClose>
        </div>
        <nav
          aria-label="Main"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pt-3 pb-4"
        >
          <PhoneLink close={close} current={isCurrentPage(pathname, "/explore")} to="/explore">
            Explore
          </PhoneLink>
          {menus.map((menu) => (
            <div className="flex flex-col gap-1" key={menu.label}>
              <span className="px-2">
                <Hud tone={menu.label === category ? "brand" : "muted"}>{menu.label}</Hud>
              </span>
              {menu.tools.map((tool) => (
                <PhoneLink close={close} current={pathname === tool.to} key={tool.to} to={tool.to}>
                  <ToolTile current={pathname === tool.to} tool={tool} />
                </PhoneLink>
              ))}
            </div>
          ))}
          <PhoneLink
            close={close}
            current={isCurrentPage(pathname, "/characters")}
            to="/characters"
          >
            Characters
          </PhoneLink>
        </nav>
        <div className="shrink-0 border-t py-2.5 pr-2 pl-4">{children(close)}</div>
      </DialogContent>
    </Dialog>
  );
}
