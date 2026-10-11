using System.Text;

namespace Marklane.Core;

/// <summary>Tracks the canonical Markdown and preserves the opened file's encoding and newlines.</summary>
public sealed class MarkdownDocument
{
    private string savedText = "";
    private Encoding encoding = new UTF8Encoding(false, true);
    private string newline = "\r\n";

    public string? FilePath { get; private set; }
    public string Text { get; set; } = "";
    public bool IsDirty => Text != savedText;
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
    }

    public async Task OpenAsync(string path)
    {
        var bytes = await File.ReadAllBytesAsync(path);
        var (detectedEncoding, skip) = DetectEncoding(bytes);
        var text = detectedEncoding.GetString(bytes, skip, bytes.Length - skip);
        // Decode fully before changing the current document: failed opens preserve current work.
        newline = text.Contains("\r\n", StringComparison.Ordinal) ? "\r\n"
            : text.Contains('\n') ? "\n" : text.Contains('\r') ? "\r" : "\r\n";
        encoding = detectedEncoding;
        FilePath = Path.GetFullPath(path);
        Text = savedText = Normalize(text);
    }

    public async Task SaveAsync(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var snapshot = Text;
        var temporary = Path.Combine(Path.GetDirectoryName(fullPath)!, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllTextAsync(temporary, snapshot.Replace("\n", newline), encoding);
            if (File.Exists(fullPath))
                File.Replace(temporary, fullPath, null);
            else
                File.Move(temporary, fullPath);
            FilePath = fullPath;
            savedText = snapshot;
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
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
