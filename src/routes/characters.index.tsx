import { createFileRoute } from "@tanstack/react-router";

import { createCharacterHref } from "#/app/composer-slots";
import { CharacterLibrary } from "#/features/characters/components/character-library";
import { type LibrarySearch, validateLibrarySearch } from "#/features/characters/library";

export const Route = createFileRoute("/characters/")({
  validateSearch: validateLibrarySearch,
  head: () => ({ meta: [{ title: "Characters · Open Photon" }] }),
  component: Characters,
});

function Characters() {
  const navigate = Route.useNavigate();

  return (
    <CharacterLibrary
      createCharacterHref={createCharacterHref}
      onSearch={(next: Partial<LibrarySearch>) =>
        void navigate({ replace: true, search: (current) => ({ ...current, ...next }) })
      }
      search={Route.useSearch()}
    />
  );
}
