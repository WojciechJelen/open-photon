import { PageHeading } from "#/shared/components/page-heading";

/**
 * A builder screen's opening: its heading and one line on what to do. The heading takes focus when
 * the screen changes (`data-step-heading`, `CharacterBuilder`), so a keyboard or screen-reader user
 * lands on the new screen.
 */
export function StepHeading({
  children,
  id,
  title,
}: {
  children?: React.ReactNode;
  id: string;
  title: string;
}) {
  return (
    <PageHeading
      subtitle={children}
      title={
        <span className="outline-none" data-step-heading="" id={id} tabIndex={-1}>
          {title}
        </span>
      }
    />
  );
}
