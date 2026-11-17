defmodule WandererApp.Map.GarbageCollector do
  @moduledoc """
  Manager map subscription plans
  """

  require Logger
  require Ash.Query

  @logger Application.compile_env(:wanderer_app, :logger)
  @one_week_seconds 7 * 24 * 60 * 60
  @two_weeks_seconds 14 * 24 * 60 * 60

  def cleanup_chain_passages() do
    Logger.info("Start cleanup old map chain passages...")

    WandererApp.Api.MapChainPassages
    |> Ash.Query.filter(updated_at: [less_than: get_cutoff_time(@one_week_seconds)])
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map chain passages processed" end)

    :ok
  end

  def cleanup_system_signatures() do
    Logger.info("Start cleanup old map system signatures...")

    WandererApp.Api.MapSystemSignature
    |> Ash.Query.filter(updated_at: [less_than: get_cutoff_time(@two_weeks_seconds)])
    |> Ash.bulk_destroy!(:destroy, %{}, batch_size: 100)

    @logger.info(fn -> "All map system signatures processed" end)

    :ok
  end

  def cleanup_expired_wormholes() do
    Logger.info("Start cleanup expired wormhole signatures...")

    now = DateTime.utc_now()

    expired_signatures =
      WandererApp.Api.MapSystemSignature
      |> Ash.Query.filter(group == "Wormhole" and deleted == false and expires_at < ^now)
      |> Ash.Query.load([:system])
      |> Ash.read!()

    expired_signatures_by_map =
      expired_signatures
      |> Enum.reject(&is_nil(&1.system))
      |> Enum.group_by(fn sig -> sig.system.map_id end)

    Enum.each(expired_signatures_by_map, fn {map_id, sigs} ->
      case WandererApp.Api.Map.by_id(map_id) do
        {:ok, map} ->
          if auto_delete_expired_wormholes?(map) do
            Logger.info(
              "Map #{map_id} has auto_delete_expired_wormholes enabled. Cleaning up #{length(sigs)} expired wormholes..."
            )

            sigs_by_system = Enum.group_by(sigs, fn sig -> sig.system.solar_system_id end)

            Enum.each(sigs_by_system, fn {system_solar_id, system_sigs} ->
              removed_params = Enum.map(system_sigs, fn sig -> %{"eve_id" => sig.eve_id} end)

              WandererApp.Map.Server.update_signatures(
                map_id,
                %{
                  solar_system_id: system_solar_id,
                  character_id: nil,
                  user_id: nil,
                  delete_connection_with_sigs: true,
                  added_signatures: [],
                  updated_signatures: [],
                  removed_signatures: removed_params
                }
              )
            end)
          end

        _ ->
          :ok
      end
    end)

    Logger.info("All expired wormhole signatures processed")
    :ok
  end

  defp auto_delete_expired_wormholes?(map) do
    case WandererApp.MapRepo.options_to_form_data(map) do
      {:ok, %{"auto_delete_expired_wormholes" => "true"}} -> true
      _ -> false
    end
  end

  defp get_cutoff_time(seconds), do: DateTime.utc_now() |> DateTime.add(-seconds, :second)
end
