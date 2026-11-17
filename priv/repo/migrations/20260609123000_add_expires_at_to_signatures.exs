defmodule WandererApp.Repo.Migrations.AddExpiresAtToSignatures do
  @moduledoc """
  Adds expires_at column to map_system_signatures_v1 table.
  """

  use Ecto.Migration

  def up do
    alter table(:map_system_signatures_v1) do
      add :expires_at, :utc_datetime
    end
  end

  def down do
    alter table(:map_system_signatures_v1) do
      remove :expires_at
    end
  end
end
