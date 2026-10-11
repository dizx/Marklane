using System.Text;
using Marklane.Core;
using Xunit;

namespace Marklane.Core.Tests;

public sealed class DocumentTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "Marklane.Tests", Guid.NewGuid().ToString("N"));

    public DocumentTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, true);

    [Fact]
    public void InitialWelcomeTextIsCleanAndOnlyEditsRequireSaving()
    {
        var document = new MarkdownDocument();
        document.New("# Welcome\r\n\r\nStart writing.\r\n");
        var initialText = document.Text;
        Assert.Null(document.FilePath);
        Assert.False(document.IsDirty);
        document.Text += "My note";
        Assert.True(document.IsDirty);
        document.Text = initialText;
        Assert.False(document.IsDirty);
        document.New();
        Assert.Equal("", document.Text);
        Assert.False(document.IsDirty);
    }

    [Theory]
    [InlineData(false, "\n")]
    [InlineData(false, "\r\n")]
    [InlineData(true, "\n")]
    [InlineData(true, "\r\n")]
    public async Task UntouchedUtf8RoundTripsByteForByte(bool bom, string newline)
    {
        var path = Path.Combine(directory, "note.md");
        await File.WriteAllTextAsync(path, $"# Æble 🌳{newline}{newline}**text**  {newline}", new UTF8Encoding(bom));
        var original = await File.ReadAllBytesAsync(path);
        var document = new MarkdownDocument();
        await document.OpenAsync(path);
        Assert.False(document.IsDirty);
        Assert.DoesNotContain('\r', document.Text);
        await document.SaveAsync(path);
        Assert.Equal(original, await File.ReadAllBytesAsync(path));
        Assert.Single(Directory.GetFiles(directory));
    }

    [Fact]
    public async Task Utf16IsPreservedOnEdit()
    {
        var path = Path.Combine(directory, "unicode.md");
        await File.WriteAllTextAsync(path, "Hello\r\n", Encoding.Unicode);
        var document = new MarkdownDocument();
        await document.OpenAsync(path);
        document.Text += "World\n";
        await document.SaveAsync(path);
        var bytes = await File.ReadAllBytesAsync(path);
        Assert.Equal(new byte[] { 0xFF, 0xFE }, bytes[..2]);
        Assert.Equal("Hello\r\nWorld\r\n", Encoding.Unicode.GetString(bytes[2..]));
    }

    [Fact]
    public async Task SaveAsAndUndoTrackDirtyState()
    {
        var path = Path.Combine(directory, "first.md");
        var other = Path.Combine(directory, "second.md");
        var document = new MarkdownDocument();
        document.New();
        document.Text = "first\n";
        Assert.True(document.IsDirty);
        await document.SaveAsync(path);
        document.Text = "changed\n";
        Assert.True(document.IsDirty);
        document.Text = "first\n";
        Assert.False(document.IsDirty);
        document.Text = "second\n";
        await document.SaveAsync(other);
        Assert.Equal("first\r\n", await File.ReadAllTextAsync(path));
        Assert.Equal("second\r\n", await File.ReadAllTextAsync(other));
        Assert.Equal(other, document.FilePath);
        Assert.False(document.IsDirty);
    }

    [Fact]
    public async Task FailedOpenAndSavePreserveCurrentWork()
    {
        var document = new MarkdownDocument();
        document.New();
        document.Text = "Keep this";
        var invalid = Path.Combine(directory, "invalid.md");
        await File.WriteAllBytesAsync(invalid, [0xFF, 0xFF, 0xFF]);
        await Assert.ThrowsAsync<DecoderFallbackException>(() => document.OpenAsync(invalid));
        Assert.Equal("Keep this", document.Text);
        Assert.Null(document.FilePath);
        await Assert.ThrowsAsync<DirectoryNotFoundException>(() => document.SaveAsync(Path.Combine(directory, "missing", "note.md")));
        Assert.True(document.IsDirty);
        Assert.Equal("Keep this", document.Text);
        Assert.Null(document.FilePath);
    }

    [Fact]
    public async Task LockedDestinationIsNotTruncated()
    {
        var path = Path.Combine(directory, "locked.md");
        await File.WriteAllTextAsync(path, "Original");
        var document = new MarkdownDocument();
        await document.OpenAsync(path);
        document.Text = "Changed";
        using (var locked = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
            await Assert.ThrowsAsync<IOException>(() => document.SaveAsync(path));
        Assert.Equal("Original", await File.ReadAllTextAsync(path));
        Assert.True(document.IsDirty);
        Assert.Single(Directory.GetFiles(directory));
    }
}
