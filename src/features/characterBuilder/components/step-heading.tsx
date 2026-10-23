import { Hud } from "#/shared/components/brand";

/**
 * A builder screen's opening: "Step N of 3", its heading and one line on what to do. The heading
 * takes focus when the screen changes (`data-step-heading`, `CharacterBuilder`), so a keyboard or
 * screen-reader user lands on the new screen.
 */
export function StepHeading({
  children,
  id,
  label,
  title,
}: {
  children: React.ReactNode;
  id: string;
  label: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Hud>{label}</Hud>
      <h1
        className="font-display text-3xl leading-none font-bold tracking-display outline-none sm:text-4xl lg:text-5xl"
        data-step-heading=""
        id={id}
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="max-w-2xl text-base text-pretty text-soft-foreground sm:text-lg">{children}</p>
    </div>
  );
}
