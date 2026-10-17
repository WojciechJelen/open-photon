import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FlaskConical } from "lucide-react";
import { buttonVariants } from "#/components/ui/button-variants";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
			<FlaskConical className="size-10 text-primary" aria-hidden="true" />
			<div className="space-y-4">
				<p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
					Comfy / framework spike
				</p>
				<h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
					One job. The whole stack.
				</h1>
				<p className="max-w-xl text-lg text-muted-foreground">
					A small test of typed navigation, a real SQLite write, and live server
					events. The render is simulated.
				</p>
			</div>
			<Link
				to="/studio"
				search={{ preset: "cinematic", take: 1 }}
				className={buttonVariants({ size: "lg", className: "w-fit" })}
			>
				Open the studio <ArrowRight aria-hidden="true" />
			</Link>
			<p className="font-mono text-xs text-muted-foreground">
				TanStack Start v1 · Tailwind · shadcn/ui · SQLite · SSE
			</p>
		</main>
	);
}
