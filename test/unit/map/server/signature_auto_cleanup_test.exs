defmodule WandererApp.Map.Server.SignatureAutoCleanupTest do
  @moduledoc """
  Unit tests for signature auto-cleanup option and smart expiration calculations.
  """
  use WandererApp.DataCase, async: false

  alias WandererApp.Api.{MapSystem, MapSystemSignature}
  alias WandererApp.Map.Server.SignaturesImpl
  alias WandererApp.Map.GarbageCollector
  alias WandererAppWeb.Factory

  import Mox

  setup :verify_on_exit!

  setup do
    Mox.set_mox_global()

    # Stub DDRT
    Test.DDRTMock
    |> stub(:init_tree, fn _name, _opts -> :ok end)
    |> stub(:insert, fn _data, _tree_name -> {:ok, %{}} end)
    |> stub(:update, fn _id, _data, _tree_name -> {:ok, %{}} end)
    |> stub(:delete, fn _ids, _tree_name -> {:ok, %{}} end)
    |> stub(:query, fn _bbox, _tree_name -> {:ok, []} end)

    # Stub CachedInfo
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
    # Create maps with auto-cleanup option set to true and false
    map_with_cleanup = Factory.create_map(%{owner_id: character.id})

    {:ok, map_with_cleanup} =
      WandererApp.MapRepo.update_options(map_with_cleanup, %{
        "auto_delete_expired_wormholes" => "true"
      })

    map_without_cleanup = Factory.create_map(%{owner_id: character.id})

    {:ok, map_without_cleanup} =
      WandererApp.MapRepo.update_options(map_without_cleanup, %{
        "auto_delete_expired_wormholes" => "false"
      })

    {:ok, system_a} =
      MapSystem.create(%{
        map_id: map_with_cleanup.id,
        solar_system_id: 30_000_142,
        name: "Jita"
      })

    {:ok, system_b} =
      MapSystem.create(%{
        map_id: map_without_cleanup.id,
        solar_system_id: 30_000_143,
        name: "Perimeter"
      })

    %{
      map_with: map_with_cleanup,
      map_without: map_without_cleanup,
      system_a: system_a,
      system_b: system_b,
      character: character
    }
  end

  describe "expires_at calculations" do
    test "wormhole with 4h time_status sets expires_at to +6 hours", %{
      map_with: map,
      system_a: system
    } do
      # 4h time status is 2. Grace period is 2 hours. Expiration should be 6 hours from now.
      custom_info = Jason.encode!(%{"time_status" => 2})

      sig_params = %{
        system_id: system.id,
        eve_id: "SIG-101",
        character_eve_id: "SYSTEM",
        name: "XYZ-123",
        group: "Wormhole",
        custom_info: custom_info,
        deleted: false
      }

      {:ok, sig} = MapSystemSignature.create(sig_params)

      # Wait! We need to run apply_update_signature to test our logic since creation in ash directly doesn't do it automatically
      # unless we call the server's update method or we test apply_update_signature directly.
      :ok = SignaturesImpl.apply_update_signature(map.id, sig, %{custom_info: custom_info})

      updated_sig = MapSystemSignature.by_id!(sig.id)
      assert not is_nil(updated_sig.expires_at)

      diff = DateTime.diff(updated_sig.expires_at, DateTime.utc_now(), :hour)
      # Roughly 6 hours
      assert diff in [5, 6]
    end

    test "wormhole with extra info (linked_system_id) sets expires_at to +26 hours", %{
      map_with: map,
      system_a: system
    } do
      # Wormhole with linked system but no explicit time status
      sig_params = %{
        system_id: system.id,
        eve_id: "SIG-102",
        character_eve_id: "SYSTEM",
        name: "XYZ-124",
        group: "Wormhole",
        linked_system_id: 30_000_143,
        deleted: false
      }

      {:ok, sig} = MapSystemSignature.create(sig_params)
      :ok = SignaturesImpl.apply_update_signature(map.id, sig, %{linked_system_id: 30_000_143})

      updated_sig = MapSystemSignature.by_id!(sig.id)
      assert not is_nil(updated_sig.expires_at)

      diff = DateTime.diff(updated_sig.expires_at, DateTime.utc_now(), :hour)
      # Default 24h + 2h grace = 26 hours
      assert diff in [25, 26]
    end

    test "wormhole with no extra info sets expires_at to +1 week", %{
      map_with: map,
      system_a: system
    } do
      # Blank wormhole
      sig_params = %{
        system_id: system.id,
        eve_id: "SIG-103",
        character_eve_id: "SYSTEM",
        name: "XYZ-125",
        group: "Wormhole",
        deleted: false
      }

      {:ok, sig} = MapSystemSignature.create(sig_params)
      :ok = SignaturesImpl.apply_update_signature(map.id, sig, %{name: "XYZ-125"})

      updated_sig = MapSystemSignature.by_id!(sig.id)
      assert not is_nil(updated_sig.expires_at)

      diff = DateTime.diff(updated_sig.expires_at, DateTime.utc_now(), :day)
      # 1 week
      assert diff in [6, 7]
    end

    test "unrelated updates like description change do NOT update expires_at", %{
      map_with: map,
      system_a: system
    } do
      custom_info = Jason.encode!(%{"time_status" => 2})

      sig_params = %{
        system_id: system.id,
        eve_id: "SIG-104",
        character_eve_id: "SYSTEM",
        name: "XYZ-126",
        group: "Wormhole",
        custom_info: custom_info,
        deleted: false
      }

      {:ok, sig} = MapSystemSignature.create(sig_params)
      :ok = SignaturesImpl.apply_update_signature(map.id, sig, %{custom_info: custom_info})

      first_updated_sig = MapSystemSignature.by_id!(sig.id)
      expires_at_first = first_updated_sig.expires_at
      assert not is_nil(expires_at_first)

      # Now update description (comment)
      :ok =
        SignaturesImpl.apply_update_signature(map.id, first_updated_sig, %{
          description: "Cool description!"
        })

      second_updated_sig = MapSystemSignature.by_id!(sig.id)
      assert second_updated_sig.description == "Cool description!"
      # expires_at MUST be exactly the same!
      assert second_updated_sig.expires_at == expires_at_first
    end
  end

  describe "garbage collector" do
    test "cleans up expired wormholes only on maps with option enabled", %{
      map_with: map_with,
      map_without: map_without,
      system_a: system_a,
      system_b: system_b
    } do
      # Create expired wormhole in map_with
      expired_time = DateTime.utc_now() |> DateTime.add(-1, :hour)

      {:ok, sig_with} =
        MapSystemSignature.create(%{
          system_id: system_a.id,
          eve_id: "SIG-EXP-1",
          character_eve_id: "SYSTEM",
          name: "EXP-001",
          group: "Wormhole",
          expires_at: expired_time,
          deleted: false
        })

      # Create expired wormhole in map_without
      {:ok, sig_without} =
        MapSystemSignature.create(%{
          system_id: system_b.id,
          eve_id: "SIG-EXP-2",
          character_eve_id: "SYSTEM",
          name: "EXP-002",
          group: "Wormhole",
          expires_at: expired_time,
          deleted: false
        })

      # Initialize cache states so update_signatures doesn't throw or complain about starting state
      WandererApp.Cache.insert("map_#{map_with.id}:started", true)
      WandererApp.Cache.insert("map_#{map_without.id}:started", true)

      # Run the Garbage Collector task
      :ok = GarbageCollector.cleanup_expired_wormholes()

      # The signature on map_with should be deleted (not found or marked deleted)
      # Wait, in the soft delete or hard destroy, the GC destroys them
      assert {:error, %Ash.Error.Invalid{errors: [%Ash.Error.Query.NotFound{}]}} =
               MapSystemSignature.by_id(sig_with.id)

      # The signature on map_without should STILL EXIST
      {:ok, still_exists} = MapSystemSignature.by_id(sig_without.id)
      assert still_exists.id == sig_without.id
    end
  end
end
