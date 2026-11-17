using Microsoft.AspNetCore.SignalR;

namespace Podium.Game;

public sealed class GameHub(GameManager games) : Hub
{
    // ---------------------------------------------------------------- Host

    Game HostGame(string pin, string hostKey)
    {
        var g = games.Get(pin) ?? throw new HubException("Spiel nicht gefunden");
        if (!string.Equals(g.HostKey, hostKey, StringComparison.Ordinal)) throw new HubException("Keine Berechtigung");
        return g;
    }

    public async Task HostConnect(string pin, string hostKey)
    {
        var g = HostGame(pin, hostKey);
        await Groups.AddToGroupAsync(Context.ConnectionId, GameManager.HostGroup(pin));
        await games.SendHostAsync(g);
    }

    public Task HostNext(string pin, string hostKey) => games.NextAsync(HostGame(pin, hostKey));
    public Task HostFinish(string pin, string hostKey) => games.FinishEarlyAsync(HostGame(pin, hostKey));
    public Task HostKick(string pin, string hostKey, string playerId) => games.KickAsync(HostGame(pin, hostKey), playerId);

    // DirectMode: spontane Fragen
    public Task<string?> HostDirectStart(string pin, string hostKey, DirectSpec spec) => games.DirectStartAsync(HostGame(pin, hostKey), spec);
    public Task HostDirectLive(string pin, string hostKey, bool live) => games.DirectSetLiveAsync(HostGame(pin, hostKey), live);
    public Task HostDirectClose(string pin, string hostKey) => games.DirectCloseAsync(HostGame(pin, hostKey));
    public Task HostDirectEnd(string pin, string hostKey) => games.DirectEndAsync(HostGame(pin, hostKey));

    // ---------------------------------------------------------------- Spieler

    public async Task<object> PlayerJoin(string pin, string nickname, Avatar avatar)
    {
        var g = games.Get(pin);
        if (g == null) return new { ok = false, error = "Kein Spiel mit dieser PIN gefunden." };
        var (p, err) = games.Join(g, nickname, avatar, Context.ConnectionId);
        if (p == null) return new { ok = false, error = err };
        await games.SendPlayerAsync(g, p);
        await games.SendHostAsync(g);
        return new { ok = true, playerId = p.Id };
    }

    /// <summary>Anonymer Zugang (Live-Fragerunde): keine Anmeldung, kein Avatar.</summary>
    public async Task<object> AudienceJoin(string pin, string? audienceId)
    {
        var g = games.Get(pin);
        if (g == null) return new { ok = false, error = "Kein Raum mit dieser PIN gefunden." };
        var (p, err) = games.JoinAnonymous(g, audienceId, Context.ConnectionId);
        if (p == null) return new { ok = false, error = err, redirect = err == "quiz" };
        await games.SendPlayerAsync(g, p);
        await games.SendHostAsync(g);
        return new { ok = true, playerId = p.Id };
    }

    public async Task<bool> PlayerRejoin(string pin, string playerId)
    {
        var g = games.Get(pin);
        if (g == null) return false;
        var p = games.Rejoin(g, playerId, Context.ConnectionId);
        if (p == null) return false;
        await games.SendPlayerAsync(g, p);
        await games.SendHostAsync(g);
        return true;
    }

    public async Task PlayerAvatar(string pin, Avatar avatar)
    {
        var g = games.Get(pin);
        if (g == null) return;
        games.UpdateAvatar(g, Context.ConnectionId, avatar);
        await games.SendHostAsync(g);
    }

    public async Task<bool> PlayerAnswer(string pin, int questionIndex, int[] choices)
    {
        var g = games.Get(pin);
        if (g == null) return false;
        var ok = await games.AnswerAsync(g, Context.ConnectionId, questionIndex, choices);
        if (ok)
        {
            Player? p;
            lock (g.Lock) p = g.Players.Values.FirstOrDefault(x => x.ConnectionId == Context.ConnectionId);
            if (p != null) await games.SendPlayerAsync(g, p);
        }
        return ok;
    }

    public async Task<string?> PlayerDirectAnswer(string pin, int directId, int[]? choices, double? number, string? text)
    {
        var g = games.Get(pin);
        if (g == null) return "Spiel nicht gefunden.";
        return await games.DirectAnswerAsync(g, Context.ConnectionId, directId, choices, number, text);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await games.DisconnectedAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
