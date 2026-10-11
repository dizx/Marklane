using System.Text.Json;
using Marklane.Core;
using Xunit;

namespace Marklane.Core.Tests;

public sealed class RecentFilesTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "Marklane.Tests", Guid.NewGuid().ToString("N"));
    private string SettingsPath => Path.Combine(directory, "settings", "recent-files.json");
    private string Note(string name) => Path.Combine(directory, name);

    public RecentFilesTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, true);

    [Fact]
    public async Task RecentFilesPersistInOrderAndReopeningMovesAnEntryToTheTop()
    {
        var store = new RecentFilesStore(SettingsPath);
        await store.RecordAsync(Note("first.md"));
        await store.RecordAsync(Note("second.md"));
        Assert.True(await store.RecordAsync(Note("FIRST.md")));
        var reloaded = new RecentFilesStore(SettingsPath);
        await reloaded.LoadAsync();
        Assert.Equal(new[] { Note("FIRST.md"), Note("second.md") }, reloaded.Files);
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(SettingsPath)!));
    }

    [Fact]
    public async Task KeepsOnlyTheTenMostRecentFiles()
    {
        var store = new RecentFilesStore(SettingsPath);
        for (var i = 0; i < 12; i++) await store.RecordAsync(Note($"{i}.md"));
        await store.LoadAsync();
        Assert.Equal(10, store.Files.Count);
        Assert.Equal(Note("11.md"), store.Files[0]);
        Assert.Equal(Note("2.md"), store.Files[^1]);
    }

    [Fact]
    public async Task RemovalAndClearPersistWithoutDeletingDocuments()
    {
        var first = Note("first.md");
        var second = Note("second.md");
        await File.WriteAllTextAsync(first, "Keep first");
        await File.WriteAllTextAsync(second, "Keep second");
        var store = new RecentFilesStore(SettingsPath);
        await store.RecordAsync(first);
        await store.RecordAsync(second);
        Assert.True(await store.RemoveAsync(first));
        await store.LoadAsync();
        Assert.Equal(new[] { second }, store.Files);
        Assert.True(await store.ClearAsync());
        await store.LoadAsync();
        Assert.Empty(store.Files);
        Assert.Equal("Keep first", await File.ReadAllTextAsync(first));
        Assert.Equal("Keep second", await File.ReadAllTextAsync(second));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("null")]
    public async Task MissingOrDamagedHistoryDoesNotPreventStartup(string contents)
    {
        var store = new RecentFilesStore(SettingsPath);
        await store.LoadAsync();
        Assert.Empty(store.Files);
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        await File.WriteAllTextAsync(SettingsPath, contents);
        await store.LoadAsync();
        Assert.Empty(store.Files);
        Assert.True(await store.RecordAsync(Note("recovered.md")));
        await store.LoadAsync();
        Assert.Equal(new[] { Note("recovered.md") }, store.Files);
    }

    [Fact]
    public async Task LoadingFiltersInvalidAndDuplicatePathsButRetainsUnavailableFiles()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        await File.WriteAllTextAsync(SettingsPath, JsonSerializer.Serialize(new[] { null, "", "relative.md", Note("missing.md"), Note("MISSING.md"), Note("other.md") }));
        var store = new RecentFilesStore(SettingsPath);
        await store.LoadAsync();
        Assert.Equal(new[] { Note("missing.md"), Note("other.md") }, store.Files);
    }

    [Fact]
    public async Task FailedPersistenceRetainsInMemoryHistoryAndExistingFile()
    {
        var store = new RecentFilesStore(SettingsPath);
        await store.RecordAsync(Note("first.md"));
        var before = await File.ReadAllTextAsync(SettingsPath);
        using (var locked = new FileStream(SettingsPath, FileMode.Open, FileAccess.Read, FileShare.None))
            Assert.False(await store.RecordAsync(Note("second.md")));
        Assert.Equal(Note("second.md"), store.Files[0]);
        Assert.Equal(before, await File.ReadAllTextAsync(SettingsPath));
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(SettingsPath)!));
    }
}
