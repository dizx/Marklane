using System.Security.Cryptography;

namespace Marklane.Core;

/// <summary>An immutable disk snapshot, tied to the document revision that observed it.</summary>
public sealed class DocumentFileChange
{
    internal DocumentFileChange(MarkdownDocument document, long revision, string path, byte[]? bytes)
    {
        Document = document;
        Revision = revision;
        FilePath = path;
        Bytes = bytes;
        Fingerprint = bytes is null ? null : Convert.ToHexString(SHA256.HashData(bytes));
    }

    internal MarkdownDocument Document { get; }
    internal long Revision { get; }
    internal byte[]? Bytes { get; }
    internal string? Fingerprint { get; }
    public string FilePath { get; }
    public bool Exists => Bytes is not null;

    public bool HasSameVersionAs(DocumentFileChange other) =>
        ReferenceEquals(Document, other.Document) && Revision == other.Revision && Fingerprint == other.Fingerprint;
}
