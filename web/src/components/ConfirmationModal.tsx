// src/components/ConfirmationModal.tsx

import Modal from './Modal';
import Button from './Button';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isProcessing?: boolean;
}

export default function ConfirmationModal({ isOpen, title, message, onConfirm, onCancel, confirmText = "Confirmar", cancelText = "Cancelar", isProcessing = false }: ConfirmationModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <div className="p-4">
        <p className="text-sm text-gray-700">{message}</p>
        <div className="mt-6 flex justify-end space-x-3">
          <Button variant="secondary" onClick={onCancel} disabled={isProcessing}>{cancelText}</Button>
          <Button variant="primary" onClick={onConfirm} disabled={isProcessing}>
            {isProcessing ? 'Procesando...' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}