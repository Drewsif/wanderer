defmodule WandererApp.Map.Server.SignatureTempNameSyncTest do
  @moduledoc """
  Tests for syncing a system's tag/labels to the linked signature's temporary name.
  """
  use WandererApp.DataCase, async: false

  import Mox

  alias WandererApp.Api.MapSystem
  alias WandererApp.Api.MapSystemSignature
  alias WandererAppWeb.Factory

  setup :verify_on_exit!

  setup do
    Mox.set_mox_global()

    Test.DDRTMock
    |> stub(:init_tree, fn _name, _opts -> :ok end)
    |> stub(:insert, fn _data, _tree_name -> {:ok, %{}} end)
    |> stub(:update, fn _id, _data, _tree_name -> {:ok, %{}} end)
    |> stub(:delete, fn _ids, _tree_name -> {:ok, %{}} end)
    |> stub(:query, fn _bbox, _tree_name -> {:ok, []} end)

    WandererApp.CachedInfo.Mock
    |> stub(:get_system_static_info, fn
      30_000_142 ->
        {:ok,
         %{
           solar_system_id: 30_000_142,
           solar_system_name: "Jita",
           system_class: 7,
           security: "0.9"
         }}

      30_000_143 ->
        {:ok,
         %{
           solar_system_id: 30_000_143,
           solar_system_name: "Perimeter",
           system_class: 7,
           security: "0.9"
         }}

      _ ->
        {:error, :not_found}
    end)

    character = Factory.create_character()
    map = Factory.create_map(%{owner_id: character.id})

    %{map: map, character: character}
  end

  describe "signature temporary_name sync" do
    test "correctly syncs tag to signature temporary_name", %{map: map} do
      {:ok, system_a} =
        MapSystem.create(%{
          map_id: map.id,
          solar_system_id: 30_000_142,
          name: "Jita"
        })

      {:ok, system_b} =
        MapSystem.create(%{
          map_id: map.id,
          solar_system_id: 30_000_143,
          name: "Perimeter"
        })

      sig =
        Factory.insert(:map_system_signature, %{
          system_id: system_a.id,
          eve_id: "SIG-123",
          name: "XYZ",
          group: "Wormhole",
          linked_system_id: system_b.solar_system_id
        })

      # Mock map_cache for update_system_by_solar_system_id/2
      Cachex.put(:map_cache, map.id, %{
        systems: %{
          system_b.solar_system_id => %{
            solar_system_id: system_b.solar_system_id
          }
        }
      })

      # Call SystemsImpl directly to trigger update_system_tag
      :ok =
        WandererApp.Map.Server.SystemsImpl.update_system_tag(map.id, %{
          solar_system_id: system_b.solar_system_id,
          tag: "A2"
        })

      updated_sig = MapSystemSignature.by_id!(sig.id)
      assert updated_sig.temporary_name == "A2"
    end

    test "correctly syncs labels to signature temporary_name", %{map: map} do
      {:ok, system_a} =
        MapSystem.create(%{
          map_id: map.id,
          solar_system_id: 30_000_142,
          name: "Jita"
        })

      {:ok, system_b} =
        MapSystem.create(%{
          map_id: map.id,
          solar_system_id: 30_000_143,
          name: "Perimeter"
        })

      sig =
        Factory.insert(:map_system_signature, %{
          system_id: system_a.id,
          eve_id: "SIG-456",
          name: "XYZ",
          group: "Wormhole",
          linked_system_id: system_b.solar_system_id
        })

      # Mock map_cache for update_system_by_solar_system_id/2
      Cachex.put(:map_cache, map.id, %{
        systems: %{
          system_b.solar_system_id => %{
            solar_system_id: system_b.solar_system_id
          }
        }
      })

      # Update system labels (JSON formatted)
      labels_json = Jason.encode!(%{"customLabel" => "B1"})

      :ok =
        WandererApp.Map.Server.SystemsImpl.update_system_labels(map.id, %{
          solar_system_id: system_b.solar_system_id,
          labels: labels_json
        })

      updated_sig = MapSystemSignature.by_id!(sig.id)
      assert updated_sig.temporary_name == "B1"
    end
  end
end
