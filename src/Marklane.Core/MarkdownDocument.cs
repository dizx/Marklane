using System.Security.Cryptography;
using System.Text;

namespace Marklane.Core;

/// <summary>Tracks the canonical Markdown and preserves the opened file's encoding and newlines.</summary>
public sealed class MarkdownDocument
{
    private string savedText = "";
    private Encoding encoding = new UTF8Encoding(false, true);
    private string newline = "\r\n";
    private string? observedFileFingerprint;
    private long revision;
    private bool keptExternalChange;

    public string? FilePath { get; private set; }
    public string Text { get; set; } = "";
    public bool IsDirty => keptExternalChange || Text != savedText;
    public string Name => FilePath is null ? "Untitled.md" : Path.GetFileName(FilePath);
    public string EncodingLabel => encoding.CodePage == 65001 ? "UTF-8" : encoding.WebName.ToUpperInvariant();
    public string NewlineLabel => newline == "\r\n" ? "CRLF" : newline == "\r" ? "CR" : "LF";

    public void New(string text = "")
    {
        FilePath = null;
        Text = Normalize(text);
        savedText = Text;
        encoding = new UTF8Encoding(false, true);
        newline = "\r\n";
        observedFileFingerprint = null;
        keptExternalChange = false;
        revision++;
    }

    public async Task OpenAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var bytes = await ReadBytesAsync(fullPath);
        LoadBytes(fullPath, bytes);
    }

    private void LoadBytes(string path, byte[] bytes)
    {
        var (detectedEncoding, skip) = DetectEncoding(bytes);
        var text = detectedEncoding.GetString(bytes, skip, bytes.Length - skip);
        // Decode fully before changing the current document: failed opens preserve current work.
        newline = text.Contains("\r\n", StringComparison.Ordinal) ? "\r\n"
            : text.Contains('\n') ? "\n" : text.Contains('\r') ? "\r" : "\r\n";
        encoding = detectedEncoding;
        FilePath = path;
        Text = savedText = Normalize(text);
        observedFileFingerprint = Convert.ToHexString(SHA256.HashData(bytes));
        keptExternalChange = false;
        revision++;
    }

    public async Task<DocumentFileChange?> GetExternalChangeAsync()
    {
        if (FilePath is not { } path) return null;
        var currentRevision = revision;
        byte[]? bytes;
        try { bytes = await ReadBytesAsync(path); }
        catch (FileNotFoundException) { bytes = null; }
        catch (DirectoryNotFoundException) { bytes = null; }
        if (currentRevision != revision) return null;
        var change = new DocumentFileChange(this, currentRevision, path, bytes);
        return change.Fingerprint == observedFileFingerprint ? null : change;
    }

    /// <summary>Reloads the observed snapshot or acknowledges it while preserving the editor's text.</summary>
    public bool ResolveExternalChange(DocumentFileChange change, bool reload)
    {
        if (!ReferenceEquals(change.Document, this) || change.Revision != revision) return false;
        if (reload)
        {
            if (change.Bytes is null) return false;
            LoadBytes(change.FilePath, change.Bytes);
        }
        else
        {
            observedFileFingerprint = change.Fingerprint;
            keptExternalChange = true;
            revision++;
        }
        return true;
    }

    public async Task SaveAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var snapshot = Text;
        var bytes = encoding.GetPreamble().Concat(encoding.GetBytes(snapshot.Replace("\n", newline))).ToArray();
        var temporary = Path.Combine(Path.GetDirectoryName(fullPath)!, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllBytesAsync(temporary, bytes);
            if (File.Exists(fullPath))
                File.Replace(temporary, fullPath, null);
            else
                File.Move(temporary, fullPath);
            FilePath = fullPath;
            savedText = snapshot;
            observedFileFingerprint = Convert.ToHexString(SHA256.HashData(bytes));
            keptExternalChange = false;
            revision++;
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static async Task<byte[]> ReadBytesAsync(string path)
    {
        // Other editors commonly replace files atomically; don't block those renames while checking.
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer);
        return buffer.ToArray();
    }

    private static string Normalize(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    private static (Encoding, int) DetectEncoding(byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF })) return (new UTF8Encoding(true, true), 3);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE, 0, 0 })) return (new UTF32Encoding(false, true, true), 4);
        if (bytes.AsSpan().StartsWith(new byte[] { 0, 0, 0xFE, 0xFF })) return (new UTF32Encoding(true, true, true), 4);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE })) return (new UnicodeEncoding(false, true, true), 2);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFE, 0xFF })) return (new UnicodeEncoding(true, true, true), 2);
        return (new UTF8Encoding(false, true), 0);
    }
}
