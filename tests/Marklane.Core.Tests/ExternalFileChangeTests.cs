using System.Text;
using Marklane.Core;
using Xunit;

namespace Marklane.Core.Tests;

public sealed class ExternalFileChangeTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "Marklane.Tests", Guid.NewGuid().ToString("N"));

    public ExternalFileChangeTests() => Directory.CreateDirectory(directory);
    public void Dispose() => Directory.Delete(directory, true);

    private async Task<MarkdownDocument> OpenAsync(string text = "Original\r\n")
    {
        var path = Path.Combine(directory, "note.md");
        await File.WriteAllTextAsync(path, text);
        var document = new MarkdownDocument();
        await document.OpenAsync(path);
        return document;
    }

    [Fact]
    public async Task OwnSavesAndIdenticalRewritesDoNotReportChanges()
    {
        var document = await OpenAsync();
        Assert.Null(await document.GetExternalChangeAsync());
        document.Text = "My edit\n";
        await document.SaveAsync(document.FilePath!);
        Assert.Null(await document.GetExternalChangeAsync());
        await File.WriteAllTextAsync(document.FilePath!, "My edit\r\n");
        Assert.Null(await document.GetExternalChangeAsync());
    }

    [Fact]
    public async Task DetectsSameSizeSameTimestampAtomicReplacementAndReloadsEncoding()
    {
        var document = await OpenAsync("Original");
        var path = document.FilePath!;
        var timestamp = File.GetLastWriteTimeUtc(path);
        var replacement = Path.Combine(directory, "replacement.tmp");
        await File.WriteAllTextAsync(replacement, "External");
        File.SetLastWriteTimeUtc(replacement, timestamp);
        File.Move(replacement, path, true);
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        Assert.True(change.HasSameVersionAs((await document.GetExternalChangeAsync())!));
        Assert.Equal("Original", document.Text);
        Assert.True(document.ResolveExternalChange(change, reload: true));
        Assert.Equal("External", document.Text);
        Assert.False(document.IsDirty);
        Assert.Null(await document.GetExternalChangeAsync());

        await File.WriteAllTextAsync(path, "Unicode æ\n", Encoding.Unicode);
        change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        Assert.True(document.ResolveExternalChange(change, reload: true));
        Assert.Equal("UTF-16", document.EncodingLabel);
        Assert.Equal("LF", document.NewlineLabel);
        var bytes = await File.ReadAllBytesAsync(path);
        await document.SaveAsync(path);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task KeepingEditorTextAcknowledgesOnlyThatDiskVersionAndRequiresSave(bool editLocally)
    {
        var document = await OpenAsync();
        if (editLocally) document.Text = "Local unsaved edits\n";
        var editorText = document.Text;
        await File.WriteAllTextAsync(document.FilePath!, "External one\n");
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        Assert.True(document.ResolveExternalChange(change, reload: false));
        Assert.Equal(editorText, document.Text);
        Assert.True(document.IsDirty);
        Assert.Null(await document.GetExternalChangeAsync());
        Assert.Equal("External one\n", await File.ReadAllTextAsync(document.FilePath!));
        await File.WriteAllTextAsync(document.FilePath!, "External two\n");
        Assert.NotNull(await document.GetExternalChangeAsync());
        await document.SaveAsync(document.FilePath!);
        Assert.False(document.IsDirty);
        Assert.Null(await document.GetExternalChangeAsync());
    }

    [Fact]
    public async Task ReloadUsesPromptedSnapshotAndDetectsAnotherWriteDuringTheDialog()
    {
        var document = await OpenAsync();
        await File.WriteAllTextAsync(document.FilePath!, "First external edit");
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        await File.WriteAllTextAsync(document.FilePath!, "Second external edit");
        Assert.True(document.ResolveExternalChange(change, reload: true));
        Assert.Equal("First external edit", document.Text);
        Assert.NotNull(await document.GetExternalChangeAsync());
    }

    [Fact]
    public async Task OldSnapshotsCannotAffectReopenedOrSavedDocuments()
    {
        var document = await OpenAsync();
        await File.WriteAllTextAsync(document.FilePath!, "External");
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        await document.OpenAsync(document.FilePath!);
        document.Text = "New local work";
        Assert.False(document.ResolveExternalChange(change, reload: true));
        Assert.Equal("New local work", document.Text);
        await File.WriteAllTextAsync(document.FilePath!, "Another external edit");
        change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        await document.SaveAsync(Path.Combine(directory, "save-as.md"));
        Assert.False(document.ResolveExternalChange(change, reload: false));
        Assert.False(document.IsDirty);
        document.New("Unsaved new document");
        Assert.False(document.ResolveExternalChange(change, reload: true));
        Assert.Null(await document.GetExternalChangeAsync());
    }

    [Fact]
    public async Task DeletionKeepsTextAndRecreationIsDetected()
    {
        var document = await OpenAsync();
        var path = document.FilePath!;
        File.Delete(path);
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        Assert.False(change.Exists);
        Assert.False(document.ResolveExternalChange(change, reload: true));
        Assert.True(document.ResolveExternalChange(change, reload: false));
        Assert.Equal("Original\n", document.Text);
        Assert.True(document.IsDirty);
        Assert.Null(await document.GetExternalChangeAsync());
        await File.WriteAllTextAsync(path, "Recreated");
        Assert.NotNull(await document.GetExternalChangeAsync());
    }

    [Fact]
    public async Task LockedFileAndInvalidReloadPreserveUnsavedWork()
    {
        var document = await OpenAsync();
        document.Text = "Unsaved work";
        using (var locked = new FileStream(document.FilePath!, FileMode.Open, FileAccess.Read, FileShare.None))
            await Assert.ThrowsAsync<IOException>(() => document.GetExternalChangeAsync());
        await File.WriteAllBytesAsync(document.FilePath!, [0xFF, 0xFF, 0xFF]);
        var change = Assert.IsType<DocumentFileChange>(await document.GetExternalChangeAsync());
        Assert.Throws<DecoderFallbackException>(() => document.ResolveExternalChange(change, reload: true));
        Assert.Equal("Unsaved work", document.Text);
        Assert.True(document.IsDirty);
        Assert.True(document.ResolveExternalChange(change, reload: false));
    }
}
