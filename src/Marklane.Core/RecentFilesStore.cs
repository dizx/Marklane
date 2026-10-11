using System.Text;
using System.Text.Json;

namespace Marklane.Core;

/// <summary>Persists a bounded, most-recent-first list of successfully opened or saved files.</summary>
public sealed class RecentFilesStore(string settingsPath)
{
    public const int MaximumFiles = 10;
    private readonly List<string> files = [];
    public IReadOnlyList<string> Files => files.AsReadOnly();

    public async Task LoadAsync()
    {
        files.Clear();
        try
        {
            var stored = JsonSerializer.Deserialize<string?[]>(await File.ReadAllTextAsync(settingsPath));
            foreach (var path in stored ?? [])
            {
                if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)) continue;
                string fullPath;
                try { fullPath = Path.GetFullPath(path); }
                catch (ArgumentException) { continue; }
                if (!files.Contains(fullPath, StringComparer.OrdinalIgnoreCase)) files.Add(fullPath);
                if (files.Count == MaximumFiles) break;
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            // Unavailable or damaged history must not prevent editing documents.
            files.Clear();
        }
    }

    public Task<bool> RecordAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        files.RemoveAll(item => string.Equals(item, fullPath, StringComparison.OrdinalIgnoreCase));
        files.Insert(0, fullPath);
        if (files.Count > MaximumFiles) files.RemoveRange(MaximumFiles, files.Count - MaximumFiles);
        return PersistAsync();
    }

    public Task<bool> RemoveAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        files.RemoveAll(item => string.Equals(item, fullPath, StringComparison.OrdinalIgnoreCase));
        return PersistAsync();
    }

    public Task<bool> ClearAsync()
    {
        files.Clear();
        return PersistAsync();
    }

    private async Task<bool> PersistAsync()
    {
        var fullPath = Path.GetFullPath(settingsPath);
        var directory = Path.GetDirectoryName(fullPath)!;
        var temporary = Path.Combine(directory, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            Directory.CreateDirectory(directory);
            var json = JsonSerializer.Serialize(files, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(temporary, json.ReplaceLineEndings("\r\n"), new UTF8Encoding(false));
            if (File.Exists(fullPath))
                File.Replace(temporary, fullPath, null);
            else
                File.Move(temporary, fullPath);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
        finally
        {
            try { File.Delete(temporary); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }
}
